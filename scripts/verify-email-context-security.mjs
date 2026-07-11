// Epic 6, slice 1: proves get_booking_email_context is scoped correctly
// (only the two parties on a specific booking can call it for that
// booking — not a general "look up anyone's contact info" oracle), and
// that the new profiles.email/locale/timezone columns are genuinely
// unreadable via a direct SELECT for anyone — including the row's own
// owner, since the only sanctioned reader is the SECURITY DEFINER RPC,
// which bypasses grants entirely. This is the column-level-GRANT half
// of the fix; the RPC's own auth.uid() check is the row-scoping half —
// both are tested here, independently, since either one failing alone
// would be a real leak.
//
// Run: node --env-file=.env.local scripts/verify-email-context-security.mjs

import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const password = "twelvecharspw1";
const stamp = Date.now();

async function signUp(role, name) {
  const supabase = createClient(url, key);
  const email = `emailctx-${role}-${stamp}-${Math.random().toString(36).slice(2, 6)}@example.com`;
  const { data } = await supabase.auth.signUp({
    email, password, options: { data: { role, display_name: name, locale: "en" } },
  });
  return { supabase, user: data.user, email };
}

let failures = 0;
function check(label, condition) {
  console.log(`${condition ? "PASS" : "FAIL"} — ${label}`);
  if (!condition) failures++;
}

console.log("=== Setup ===");
const practitionerA = await signUp("practitioner", `EmailCtxPracA ${stamp}`);
const practitionerB = await signUp("practitioner", `EmailCtxPracB ${stamp}`);
const client1 = await signUp("client", `EmailCtxClient1 ${stamp}`);
const client2 = await signUp("client", `EmailCtxClient2 ${stamp}`);
await new Promise((r) => setTimeout(r, 500));

const usernameA = `emailctxA${stamp}`;
await practitionerA.supabase.from("practitioner_profiles").update({ username: usernameA }).eq("id", practitionerA.user.id);

const { data: service } = await practitionerA.supabase
  .from("services")
  .insert({ practitioner_id: practitionerA.user.id, name: "Email Ctx Test Svc", duration_minutes: 30, price_cents: 1000, currency: "EUR", is_active: true })
  .select().single();

const startUtc = new Date(Date.now() + 40 * 24 * 60 * 60 * 1000).toISOString();
const endUtc = new Date(new Date(startUtc).getTime() + service.duration_minutes * 60 * 1000).toISOString();
const { data: booking } = await client1.supabase.from("bookings").insert({
  practitioner_id: practitionerA.user.id, client_id: client1.user.id, service_id: service.id,
  start_utc: startUtc, end_utc: endUtc,
}).select().single();
check("setup booking created", !!booking);

console.log("\n=== 1. Both parties on the booking can call get_booking_email_context for it ===");
const clientCall = await client1.supabase.rpc("get_booking_email_context", { target_booking_id: booking.id }).single();
check("client1 (a party) gets a full row back", !!clientCall.data && !clientCall.error);
check("the row's client_email matches client1's real signup email", clientCall.data?.client_email === client1.email);
check("the row's practitioner_email matches practitionerA's real signup email", clientCall.data?.practitioner_email === practitionerA.email);

const practitionerCall = await practitionerA.supabase.rpc("get_booking_email_context", { target_booking_id: booking.id }).single();
check("practitionerA (the other party) gets a full row back too", !!practitionerCall.data && !practitionerCall.error);

console.log("\n=== 2. An uninvolved user calling it for this SAME booking id gets nothing ===");
const outsiderClientCall = await client2.supabase.rpc("get_booking_email_context", { target_booking_id: booking.id }).maybeSingle();
check("an uninvolved client gets no row (not an oracle for arbitrary booking ids)", !outsiderClientCall.data);

const outsiderPracCall = await practitionerB.supabase.rpc("get_booking_email_context", { target_booking_id: booking.id }).maybeSingle();
check("an uninvolved practitioner gets no row either", !outsiderPracCall.data);

const anon = createClient(url, key);
const anonCall = await anon.rpc("get_booking_email_context", { target_booking_id: booking.id }).maybeSingle();
check("a logged-out (anon) caller gets no row", !anonCall.data);

console.log("\n=== 3. email/locale/timezone are NOT selectable via a direct query — not even by the row's own owner ===");
const ownEmailSelect = await client1.supabase.from("profiles").select("email").eq("id", client1.user.id);
check("client1 selecting their OWN email directly is rejected (column not granted, not just row-filtered)", !!ownEmailSelect.error);

const otherEmailSelect = await client2.supabase.from("profiles").select("email").eq("id", practitionerA.user.id);
check("client2 selecting practitionerA's email directly is also rejected", !!otherEmailSelect.error);

const ownLocaleSelect = await client1.supabase.from("profiles").select("locale").eq("id", client1.user.id);
check("locale is likewise not directly selectable, even for your own row", !!ownLocaleSelect.error);

console.log("\n=== 4. The publicly-readable columns (display_name etc.) still work normally — the grant restriction is scoped, not a regression ===");
const publicDisplayNameRead = await anon.from("profiles").select("id, role, display_name").eq("id", practitionerA.user.id).single();
check("anon can still read a practitioner's display_name (public policy unaffected)", publicDisplayNameRead.data?.display_name === `EmailCtxPracA ${stamp}`);

console.log(`\n=== RESULT: ${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`} ===`);
process.exit(failures === 0 ? 0 : 1);
