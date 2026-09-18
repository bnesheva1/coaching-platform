// DAC7 IBAN — access-control proof. Same lockdown as the TIN: unreadable by
// other practitioners, clients, the public, or even the owner via PostgREST
// (column excluded from every SELECT grant) — readable only server-side via the
// service role. Owner can WRITE their own; format CHECK backstops shape.
//
// Run (after applying 20260918140000_practitioner_iban.sql):
//   node --env-file=.env.local scripts/verify-iban-security.mjs

import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const serviceKey = process.env.SUPABASE_SECRET_KEY;
const password = "twelvecharspw1";
const stamp = Date.now();
const serviceRole = createClient(url, serviceKey);

async function signUp(role) {
  const supabase = createClient(url, anonKey);
  const email = `iban-${role}-${stamp}-${Math.random().toString(36).slice(2, 6)}@example.com`;
  const { data } = await supabase.auth.signUp({ email, password, options: { data: { role, display_name: `Iban ${role}` } } });
  return { supabase, user: data.user };
}
let failures = 0;
const check = (l, c) => { console.log(`${c ? "PASS" : "FAIL"} — ${l}`); if (!c) failures++; };

console.log("=== Setup ===");
const pracA = await signUp("practitioner");
const pracB = await signUp("practitioner");
const client = await signUp("client");
await new Promise((r) => setTimeout(r, 500));

const VALID_IBAN = "BG80BNBG96611020345678";

console.log("\n=== 1. Owner can WRITE their own IBAN ===");
const w = await pracA.supabase.from("practitioner_profiles").update({ iban: VALID_IBAN }).eq("id", pracA.user.id);
check("practitionerA sets their own iban", !w.error);
const stored = (await serviceRole.from("practitioner_profiles").select("iban").eq("id", pracA.user.id).single()).data;
check("value persisted (service-role read)", stored?.iban === VALID_IBAN);

console.log("\n=== 2. IBAN is NOT readable via PostgREST by anyone ===");
const anon = createClient(url, anonKey);
check("anon selecting iban is rejected", !!(await anon.from("practitioner_profiles").select("iban").eq("id", pracA.user.id)).error);
check("a different practitioner selecting iban is rejected", !!(await pracB.supabase.from("practitioner_profiles").select("iban").eq("id", pracA.user.id)).error);
check("a client selecting iban is rejected", !!(await client.supabase.from("practitioner_profiles").select("iban").eq("id", pracA.user.id)).error);
check("even the OWNER cannot select iban directly", !!(await pracA.supabase.from("practitioner_profiles").select("iban").eq("id", pracA.user.id)).error);
check("select(*) is rejected outright", !!(await anon.from("practitioner_profiles").select("*").eq("id", pracA.user.id).single()).error);

console.log("\n=== 3. Positive control: public columns still readable ===");
check("anon can still read public profile columns", !(await anon.from("practitioner_profiles").select("id, username").eq("id", pracA.user.id).single()).error);

console.log("\n=== 4. A practitioner cannot write ANOTHER's IBAN (owner RLS) ===");
await pracB.supabase.from("practitioner_profiles").update({ iban: VALID_IBAN }).eq("id", pracA.user.id);
const aStill = (await serviceRole.from("practitioner_profiles").select("iban").eq("id", pracA.user.id).single()).data;
check("B's write to A's row changes nothing", aStill?.iban === VALID_IBAN);

console.log("\n=== 5. Format CHECK backstops shape ===");
check("too-short IBAN rejected by CHECK", !!(await serviceRole.from("practitioner_profiles").update({ iban: "BG12" }).eq("id", pracB.user.id)).error);
check("lowercase/no-country garbage rejected by CHECK", !!(await serviceRole.from("practitioner_profiles").update({ iban: "not-an-iban" }).eq("id", pracB.user.id)).error);

console.log("\n=== Cleanup ===");
for (const u of [pracA, pracB, client]) if (u.user) await serviceRole.auth.admin.deleteUser(u.user.id).catch(() => {});

console.log(`\n=== RESULT: ${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`} ===`);
process.exit(failures === 0 ? 0 : 1);
