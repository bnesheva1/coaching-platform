// Tests everything around the booking write that isn't the pure
// concurrency race (covered separately in
// scripts/verify-booking-concurrency.mjs): sequential already-taken
// rejection, RLS blocking mismatched service/practitioner pairs and
// duration forgery, practitioners/logged-out users being unable to book,
// and the get_practitioner_busy_times RPC — the exact mechanism
// getBookableSlots depends on to exclude taken slots from what's
// publicly offered — correctly reflecting a real booking without
// leaking who made it.
//
// Run: node --env-file=.env.local scripts/verify-booking-security.mjs

import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const password = "twelvecharspw1";
const stamp = Date.now();

async function signUp(role, name) {
  const supabase = createClient(url, key);
  const email = `booksec-${role}-${stamp}-${Math.random().toString(36).slice(2, 6)}@example.com`;
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
const practitionerA = await signUp("practitioner", `BookSecPracA ${stamp}`);
const practitionerB = await signUp("practitioner", `BookSecPracB ${stamp}`);
const client1 = await signUp("client", `BookSecClient1 ${stamp}`);
const client2 = await signUp("client", `BookSecClient2 ${stamp}`);
const rogueAsPractitioner = await signUp("practitioner", `BookSecRogue ${stamp}`);
await new Promise((r) => setTimeout(r, 500));

const usernameA = `booksecA${stamp}`;
await practitionerA.supabase.from("practitioner_profiles").update({ username: usernameA }).eq("id", practitionerA.user.id);
const usernameB = `booksecB${stamp}`;
await practitionerB.supabase.from("practitioner_profiles").update({ username: usernameB }).eq("id", practitionerB.user.id);

// .select("id, duration_minutes") only — delivery_info is excluded
// from the column grant, and a bare .select() implicitly requests
// every granted-visible column via RETURNING.
const { data: serviceA } = await practitionerA.supabase
  .from("services")
  .insert({ practitioner_id: practitionerA.user.id, name: "Sec Test Svc A", duration_minutes: 30, price_cents: 1000, currency: "EUR", is_active: true, delivery_type: "online", delivery_info: "https://example.com/meeting" })
  .select("id, duration_minutes").single();
const { data: serviceB } = await practitionerB.supabase
  .from("services")
  .insert({ practitioner_id: practitionerB.user.id, name: "Sec Test Svc B", duration_minutes: 45, price_cents: 1000, currency: "EUR", is_active: true, delivery_type: "online", delivery_info: "https://example.com/meeting" })
  .select("id, duration_minutes").single();

function slotFor(daysAhead, durationMinutes) {
  const start = new Date(Date.now() + daysAhead * 24 * 60 * 60 * 1000).toISOString();
  const end = new Date(new Date(start).getTime() + durationMinutes * 60 * 1000).toISOString();
  return { start, end };
}

console.log("\n=== 1. Sequential already-taken: client1 books, client2 tries the same slot ===");
const slot1 = slotFor(8, serviceA.duration_minutes);
const firstBooking = await client1.supabase.from("bookings").insert({
  practitioner_id: practitionerA.user.id, client_id: client1.user.id, service_id: serviceA.id,
  start_utc: slot1.start, end_utc: slot1.end,
}).select();
check("client1's booking succeeds", !firstBooking.error && (firstBooking.data ?? []).length === 1);

const secondBooking = await client2.supabase.from("bookings").insert({
  practitioner_id: practitionerA.user.id, client_id: client2.user.id, service_id: serviceA.id,
  start_utc: slot1.start, end_utc: slot1.end,
}).select();
check("client2's booking of the SAME already-taken slot is rejected", !!secondBooking.error);
check("rejection is the exclusion constraint specifically", secondBooking.error?.code === "23P01");

const stillThere = await practitionerA.supabase.from("bookings").select("client_id").eq("practitioner_id", practitionerA.user.id).eq("start_utc", slot1.start);
check("client1's original booking is untouched", stillThere.data?.[0]?.client_id === client1.user.id);

console.log("\n=== 2. Mismatched service/practitioner pair rejected (forged direct-API attempt) ===");
const slot2 = slotFor(9, serviceB.duration_minutes);
const mismatched = await client1.supabase.from("bookings").insert({
  practitioner_id: practitionerA.user.id, // A's practitioner_id
  client_id: client1.user.id,
  service_id: serviceB.id, // but B's service
  start_utc: slot2.start, end_utc: slot2.end,
}).select();
check("mismatched practitioner/service pair rejected by RLS", !!mismatched.error);

console.log("\n=== 3. Duration forgery rejected (end_utc not matching service duration) ===");
const slot3 = slotFor(10, serviceA.duration_minutes);
const forgedDuration = await client1.supabase.from("bookings").insert({
  practitioner_id: practitionerA.user.id,
  client_id: client1.user.id,
  service_id: serviceA.id,
  start_utc: slot3.start,
  end_utc: new Date(new Date(slot3.start).getTime() + 999 * 60 * 1000).toISOString(), // way longer than the real 30min duration
}).select();
check("forged (mismatched) duration rejected by RLS", !!forgedDuration.error);

console.log("\n=== 4. A practitioner cannot book (only clients) ===");
const slot4 = slotFor(11, serviceA.duration_minutes);
const practitionerBookingAttempt = await rogueAsPractitioner.supabase.from("bookings").insert({
  practitioner_id: practitionerA.user.id,
  client_id: rogueAsPractitioner.user.id,
  service_id: serviceA.id,
  start_utc: slot4.start, end_utc: slot4.end,
}).select();
check("practitioner-role account cannot create a booking", !!practitionerBookingAttempt.error);

console.log("\n=== 5. A logged-out user cannot book ===");
const anon = createClient(url, key);
const slot5 = slotFor(12, serviceA.duration_minutes);
const anonBookingAttempt = await anon.from("bookings").insert({
  practitioner_id: practitionerA.user.id,
  client_id: client1.user.id, // even if pretending to be a real client id
  service_id: serviceA.id,
  start_utc: slot5.start, end_utc: slot5.end,
}).select();
check("logged-out (anon) request cannot create a booking", !!anonBookingAttempt.error);

console.log("\n=== 6. get_practitioner_busy_times reflects the real booking, without leaking who made it ===");
const windowStart = new Date(Date.now()).toISOString();
const windowEnd = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
const busyTimes = await anon.rpc("get_practitioner_busy_times", {
  target_practitioner_id: practitionerA.user.id,
  window_start: windowStart,
  window_end: windowEnd,
});
console.log("busy times (anon, unauthenticated):", busyTimes.data, "| error:", busyTimes.error?.message ?? "none");
const matchingBusyTime = (busyTimes.data ?? []).find(
  (b) => new Date(b.start_utc).getTime() === new Date(slot1.start).getTime(),
);
check("the real booking's time range IS visible via the RPC (needed to exclude it from offered slots)", !!matchingBusyTime);
check("the RPC does NOT expose client_id, service_id, or booking id (only start_utc/end_utc)", matchingBusyTime && Object.keys(matchingBusyTime).sort().join(",") === "end_utc,start_utc");

console.log("\n=== 7. Bookings themselves are never publicly readable directly ===");
const directReadAttempt = await anon.from("bookings").select("*").eq("practitioner_id", practitionerA.user.id);
check("anon cannot read the bookings table directly at all", (directReadAttempt.data ?? []).length === 0);

console.log(`\n=== RESULT: ${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`} ===`);
process.exit(failures === 0 ? 0 : 1);
