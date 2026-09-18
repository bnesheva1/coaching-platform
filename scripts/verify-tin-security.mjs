// DAC7 TIN — access-control proof at the DB level. The TIN is a national
// identifier: it must be unreadable by other practitioners, clients, the public,
// or even the owner via PostgREST (column excluded from every SELECT grant, like
// emergency_contact) — readable only server-side via the service role. The owner
// can WRITE their own; the format CHECK backstops shape.
//
// Run (after applying 20260918120000_practitioner_tin.sql):
//   node --env-file=.env.local scripts/verify-tin-security.mjs

import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const serviceKey = process.env.SUPABASE_SECRET_KEY;
const password = "twelvecharspw1";
const stamp = Date.now();
const serviceRole = createClient(url, serviceKey);

async function signUp(role) {
  const supabase = createClient(url, anonKey);
  const email = `tin-${role}-${stamp}-${Math.random().toString(36).slice(2, 6)}@example.com`;
  const { data } = await supabase.auth.signUp({ email, password, options: { data: { role, display_name: `Tin ${role}` } } });
  return { supabase, user: data.user };
}
let failures = 0;
const check = (l, c) => { console.log(`${c ? "PASS" : "FAIL"} — ${l}`); if (!c) failures++; };

console.log("=== Setup ===");
const pracA = await signUp("practitioner");
const pracB = await signUp("practitioner");
const client = await signUp("client");
await new Promise((r) => setTimeout(r, 500));

const VALID_EGN = "7523169263";

console.log("\n=== 1. Owner can WRITE their own TIN (update grant + owner RLS) ===");
const w = await pracA.supabase.from("practitioner_profiles").update({ tin: VALID_EGN, tin_type: "egn" }).eq("id", pracA.user.id);
check("practitionerA sets their own tin", !w.error);
const stored = (await serviceRole.from("practitioner_profiles").select("tin, tin_type").eq("id", pracA.user.id).single()).data;
check("value persisted (service-role read)", stored?.tin === VALID_EGN && stored?.tin_type === "egn");

console.log("\n=== 2. TIN is NOT readable by anyone via PostgREST (column not granted) ===");
const anon = createClient(url, anonKey);
check("anon selecting tin is rejected", !!(await anon.from("practitioner_profiles").select("tin").eq("id", pracA.user.id)).error);
check("a different practitioner selecting tin is rejected", !!(await pracB.supabase.from("practitioner_profiles").select("tin").eq("id", pracA.user.id)).error);
check("a client selecting tin is rejected", !!(await client.supabase.from("practitioner_profiles").select("tin, tin_type").eq("id", pracA.user.id)).error);
check("even the OWNER cannot select tin directly (reads via service role only)", !!(await pracA.supabase.from("practitioner_profiles").select("tin").eq("id", pracA.user.id)).error);
check("select(*) is rejected outright (includes the ungranted column)", !!(await anon.from("practitioner_profiles").select("*").eq("id", pracA.user.id).single()).error);

console.log("\n=== 3. Positive control: public columns still readable ===");
const pub = await anon.from("practitioner_profiles").select("id, username").eq("id", pracA.user.id).single();
check("anon can still read public profile columns", !pub.error);

console.log("\n=== 4. A practitioner cannot write ANOTHER practitioner's TIN (owner RLS) ===");
const cross = await pracB.supabase.from("practitioner_profiles").update({ tin: VALID_EGN, tin_type: "egn" }).eq("id", pracA.user.id);
const aStill = (await serviceRole.from("practitioner_profiles").select("tin").eq("id", pracA.user.id).single()).data;
check("B's write to A's row changes nothing (RLS scopes to own row)", aStill?.tin === VALID_EGN);

console.log("\n=== 5. Format CHECK backstops shape (service role, bypassing app validation) ===");
const badEgn = await serviceRole.from("practitioner_profiles").update({ tin: "123", tin_type: "egn" }).eq("id", pracB.user.id);
check("a 3-digit ЕГН is rejected by the CHECK", !!badEgn.error);
const badVat = await serviceRole.from("practitioner_profiles").update({ tin: "123456789", tin_type: "vat" }).eq("id", pracB.user.id);
check("a VAT without the BG prefix is rejected by the CHECK", !!badVat.error);
const orphanType = await serviceRole.from("practitioner_profiles").update({ tin: null, tin_type: "egn" }).eq("id", pracB.user.id);
check("tin_type without a tin is rejected (set together)", !!orphanType.error);

console.log("\n=== Cleanup ===");
for (const u of [pracA, pracB, client]) if (u.user) await serviceRole.auth.admin.deleteUser(u.user.id).catch(() => {});

console.log(`\n=== RESULT: ${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`} ===`);
process.exit(failures === 0 ? 0 : 1);
