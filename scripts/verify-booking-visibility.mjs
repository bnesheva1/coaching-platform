// Epic 5, booking visibility slice. Proves the bookings SELECT RLS
// policy (auth.uid() = client_id or auth.uid() = practitioner_id) does
// what the dashboard queries rely on: each side can read their own
// bookings, and — critically — an uninvolved user gets zero rows no
// matter what filter or literal booking id they try, including a
// direct ID-guessing attempt. USING clauses apply before any query
// filter is evaluated, so this isn't just "their own filter excludes
// it" — it's the database refusing to return the row at all.
//
// Run: node --env-file=.env.local scripts/verify-booking-visibility.mjs

import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const password = "twelvecharspw1";
const stamp = Date.now();

async function signUp(role, name) {
  const supabase = createClient(url, key);
  const email = `bookvis-${role}-${stamp}-${Math.random().toString(36).slice(2, 6)}@example.com`;
  const { data } = await supabase.auth.signUp({
    email, password, options: { data: { role, display_name: name } },
  });
  return { supabase, user: data.user };
}

let failures = 0;
function check(label, condition) {
  console.log(`${condition ? "PASS" : "FAIL"} — ${label}`);
  if (!condition) failures++;
}

console.log("=== Setup ===");
const practitionerA = await signUp("practitioner", `BookVisPracA ${stamp}`);
const practitionerB = await signUp("practitioner", `BookVisPracB ${stamp}`);
const client1 = await signUp("client", `BookVisClient1 ${stamp}`);
const client2 = await signUp("client", `BookVisClient2 ${stamp}`);
await new Promise((r) => setTimeout(r, 500));

const usernameA = `bookvisA${stamp}`;
await practitionerA.supabase.from("practitioner_profiles").update({ username: usernameA }).eq("id", practitionerA.user.id);

const { data: service } = await practitionerA.supabase
  .from("services")
  .insert({ practitioner_id: practitionerA.user.id, name: "Vis Test Svc", duration_minutes: 30, price_cents: 1000, currency: "EUR", is_active: true })
  .select().single();

const startUtc = new Date(Date.now() + 6 * 24 * 60 * 60 * 1000).toISOString();
const endUtc = new Date(new Date(startUtc).getTime() + service.duration_minutes * 60 * 1000).toISOString();

const { data: booking } = await client1.supabase.from("bookings").insert({
  practitioner_id: practitionerA.user.id, client_id: client1.user.id, service_id: service.id,
  start_utc: startUtc, end_utc: endUtc,
}).select().single();
check("setup booking created", !!booking);

console.log("\n=== 1. Each involved party can read their own booking ===");
const client1Read = await client1.supabase.from("bookings").select("id").eq("client_id", client1.user.id);
check("client1 can read their own booking via client_id filter", (client1Read.data ?? []).some((b) => b.id === booking.id));

const practitionerARead = await practitionerA.supabase.from("bookings").select("id").eq("practitioner_id", practitionerA.user.id);
check("practitionerA can read the same booking via practitioner_id filter", (practitionerARead.data ?? []).some((b) => b.id === booking.id));

console.log("\n=== 2. An uninvolved client cannot read it, even filtering by the real client_id ===");
const client2Attempt = await client2.supabase.from("bookings").select("id").eq("client_id", client1.user.id);
check("client2 querying client1's client_id gets zero rows (RLS wins over the filter)", (client2Attempt.data ?? []).length === 0);

console.log("\n=== 3. An uninvolved practitioner cannot read it, even filtering by the real practitioner_id ===");
const practitionerBAttempt = await practitionerB.supabase.from("bookings").select("id").eq("practitioner_id", practitionerA.user.id);
check("practitionerB querying practitionerA's practitioner_id gets zero rows", (practitionerBAttempt.data ?? []).length === 0);

console.log("\n=== 4. Direct ID-guessing: an uninvolved user querying the exact real booking id gets nothing ===");
const enumerationAttempt = await client2.supabase.from("bookings").select("*").eq("id", booking.id);
check("client2 guessing the real booking id (no other filter) gets zero rows", (enumerationAttempt.data ?? []).length === 0);

console.log("\n=== 5. Logged-out (anon) gets zero rows on any bookings query ===");
const anon = createClient(url, key);
const anonAttempt = await anon.from("bookings").select("*").eq("id", booking.id);
check("anon guessing the real booking id gets zero rows", (anonAttempt.data ?? []).length === 0);
const anonUnfiltered = await anon.from("bookings").select("*");
check("anon with no filter at all gets zero rows", (anonUnfiltered.data ?? []).length === 0);

console.log(`\n=== RESULT: ${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`} ===`);
process.exit(failures === 0 ? 0 : 1);
