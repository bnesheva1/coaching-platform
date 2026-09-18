// DAC7 mailing address — access-control proof. Same lockdown as TIN/IBAN: the
// address_* columns are unreadable by other practitioners, clients, the public,
// or even the owner via PostgREST — readable only server-side via the service
// role. Owner can WRITE their own; CHECKs backstop all-or-nothing + country.
//
// Run (after applying 20260918150000_practitioner_address.sql):
//   node --env-file=.env.local scripts/verify-address-security.mjs

import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const serviceKey = process.env.SUPABASE_SECRET_KEY;
const password = "twelvecharspw1";
const stamp = Date.now();
const serviceRole = createClient(url, serviceKey);

async function signUp(role) {
  const supabase = createClient(url, anonKey);
  const email = `addr-${role}-${stamp}-${Math.random().toString(36).slice(2, 6)}@example.com`;
  const { data } = await supabase.auth.signUp({ email, password, options: { data: { role, display_name: `Addr ${role}` } } });
  return { supabase, user: data.user };
}
let failures = 0;
const check = (l, c) => { console.log(`${c ? "PASS" : "FAIL"} — ${l}`); if (!c) failures++; };
const ADDR = { address_street: "ul. Vitosha", address_building: "12A", address_postcode: "1000", address_city: "Sofia", address_country: "BG" };

console.log("=== Setup ===");
const pracA = await signUp("practitioner");
const pracB = await signUp("practitioner");
const client = await signUp("client");
await new Promise((r) => setTimeout(r, 500));

console.log("\n=== 1. Owner can WRITE their own address ===");
const w = await pracA.supabase.from("practitioner_profiles").update(ADDR).eq("id", pracA.user.id);
check("practitionerA sets their own address", !w.error);
const stored = (await serviceRole.from("practitioner_profiles").select("address_street, address_city, address_country").eq("id", pracA.user.id).single()).data;
check("value persisted (service-role read)", stored?.address_street === "ul. Vitosha" && stored?.address_city === "Sofia" && stored?.address_country === "BG");

console.log("\n=== 2. Address is NOT readable via PostgREST by anyone ===");
const anon = createClient(url, anonKey);
check("anon selecting address_street is rejected", !!(await anon.from("practitioner_profiles").select("address_street").eq("id", pracA.user.id)).error);
check("a different practitioner selecting address is rejected", !!(await pracB.supabase.from("practitioner_profiles").select("address_street, address_city").eq("id", pracA.user.id)).error);
check("a client selecting address is rejected", !!(await client.supabase.from("practitioner_profiles").select("address_postcode").eq("id", pracA.user.id)).error);
check("even the OWNER cannot select address directly", !!(await pracA.supabase.from("practitioner_profiles").select("address_street").eq("id", pracA.user.id)).error);
check("select(*) is rejected outright", !!(await anon.from("practitioner_profiles").select("*").eq("id", pracA.user.id).single()).error);

console.log("\n=== 3. Positive control: public columns still readable ===");
check("anon can still read public profile columns", !(await anon.from("practitioner_profiles").select("id, username").eq("id", pracA.user.id).single()).error);

console.log("\n=== 4. A practitioner cannot write ANOTHER's address (owner RLS) ===");
await pracB.supabase.from("practitioner_profiles").update({ ...ADDR, address_city: "Plovdiv" }).eq("id", pracA.user.id);
const aStill = (await serviceRole.from("practitioner_profiles").select("address_city").eq("id", pracA.user.id).single()).data;
check("B's write to A's row changes nothing", aStill?.address_city === "Sofia");

console.log("\n=== 5. CHECK backstops: all-or-nothing + country format ===");
check("partial address (street only) rejected by all-or-nothing CHECK", !!(await serviceRole.from("practitioner_profiles").update({ address_street: "X", address_building: null, address_postcode: null, address_city: null, address_country: null }).eq("id", pracB.user.id)).error);
check("3-letter country rejected by country CHECK", !!(await serviceRole.from("practitioner_profiles").update({ address_street: "X", address_building: "1", address_postcode: "1000", address_city: "S", address_country: "BGR" }).eq("id", pracB.user.id)).error);

console.log("\n=== Cleanup ===");
for (const u of [pracA, pracB, client]) if (u.user) await serviceRole.auth.admin.deleteUser(u.user.id).catch(() => {});

console.log(`\n=== RESULT: ${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`} ===`);
process.exit(failures === 0 ? 0 : 1);
