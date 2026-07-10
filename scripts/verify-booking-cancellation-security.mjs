// Epic 5: booking cancellation. Proves the asymmetric cancellation
// rules hold at the DB level, not just in the app:
//   - a client can cancel their own booking outside the notice cutoff,
//     but NOT within it, even via a direct API call (the actual
//     adversarial case the notice cutoff exists to close);
//   - a client cannot cancel another client's booking, or smuggle a
//     'cancelled_by_practitioner' status onto their own booking;
//   - a practitioner can cancel their own booking at ANY time,
//     including within the client's notice window (emergencies);
//   - a practitioner cannot cancel another practitioner's booking;
//   - an UPDATE touching any column besides `status` is rejected
//     outright by the column-level GRANT, before RLS is even
//     consulted;
//   - a direct-API booking insert inside the notice window is rejected
//     by the widened INSERT policy;
//   - cancelling actually frees the slot (get_practitioner_busy_times
//     no longer reports it).
//
// Note: the widened INSERT policy means a booking that starts "within
// the cutoff" can no longer be created directly at the default 24h
// setting — that's the correct, intended behavior, but it means the
// within-cutoff tests need a practitioner whose min_notice_hours starts
// low (so the setup insert is allowed) and is only raised to a real
// value AFTER the booking exists, mirroring how a real booking
// naturally drifts into a practitioner's notice window as time passes.
//
// Run: node --env-file=.env.local scripts/verify-booking-cancellation-security.mjs

import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const password = "twelvecharspw1";
const stamp = Date.now();

async function signUp(role, name) {
  const supabase = createClient(url, key);
  const email = `bookcancel-${role}-${stamp}-${Math.random().toString(36).slice(2, 6)}@example.com`;
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
const practitionerA = await signUp("practitioner", `BookCancelPracA ${stamp}`);
const practitionerB = await signUp("practitioner", `BookCancelPracB ${stamp}`);
// A dedicated practitioner for the within-cutoff tests, whose
// min_notice_hours starts at 1 (the DB-enforced minimum) so a near-term
// booking can even be created, then gets raised afterward — see note
// above.
const practitionerC = await signUp("practitioner", `BookCancelPracC ${stamp}`);
const client1 = await signUp("client", `BookCancelClient1 ${stamp}`);
const client2 = await signUp("client", `BookCancelClient2 ${stamp}`);
await new Promise((r) => setTimeout(r, 500));

const usernameA = `bookcancelA${stamp}`;
await practitionerA.supabase.from("practitioner_profiles").update({ username: usernameA }).eq("id", practitionerA.user.id);
// Default min_notice_hours (24) is left as-is for practitionerA.

const usernameC = `bookcancelC${stamp}`;
await practitionerC.supabase.from("practitioner_profiles").update({ username: usernameC, min_notice_hours: 1 }).eq("id", practitionerC.user.id);

const { data: serviceA } = await practitionerA.supabase
  .from("services")
  .insert({ practitioner_id: practitionerA.user.id, name: "Cancel Test Svc A", duration_minutes: 30, price_cents: 1000, currency: "EUR", is_active: true })
  .select().single();
const { data: serviceC } = await practitionerC.supabase
  .from("services")
  .insert({ practitioner_id: practitionerC.user.id, name: "Cancel Test Svc C", duration_minutes: 30, price_cents: 1000, currency: "EUR", is_active: true })
  .select().single();

function slotFor(hoursAhead, durationMinutes) {
  const start = new Date(Date.now() + hoursAhead * 60 * 60 * 1000).toISOString();
  const end = new Date(new Date(start).getTime() + durationMinutes * 60 * 1000).toISOString();
  return { start, end };
}

async function bookAsClient(client, practitioner, service, hoursAhead) {
  const slot = slotFor(hoursAhead, service.duration_minutes);
  const { data, error } = await client.supabase
    .from("bookings")
    .insert({
      practitioner_id: practitioner.user.id,
      client_id: client.user.id,
      service_id: service.id,
      start_utc: slot.start,
      end_utc: slot.end,
    })
    .select()
    .single();
  return { booking: data, error, slot };
}

// Every practitionerA booking below uses a distinct hour offset, spaced
// well beyond the 30-minute service duration, so none of these setup
// inserts collide with each other via the double-booking exclusion
// constraint (which is scoped per practitioner_id).
console.log("\n=== 1. Client cancels their own booking OUTSIDE the notice cutoff (succeeds) ===");
const outside = await bookAsClient(client1, practitionerA, serviceA, 40);
check("setup booking (40h ahead) created", !!outside.booking);
const outsideCancel = await client1.supabase
  .from("bookings")
  .update({ status: "cancelled_by_client" })
  .eq("id", outside.booking?.id ?? "")
  .eq("client_id", client1.user.id)
  .select();
check("client1's cancellation outside the cutoff succeeds", (outsideCancel.data ?? []).length === 1);
check("resulting status is cancelled_by_client", outsideCancel.data?.[0]?.status === "cancelled_by_client");

console.log("\n=== 2. Client attempts to cancel their own booking WITHIN the cutoff via direct API (rejected) ===");
const inside = await bookAsClient(client1, practitionerC, serviceC, 3); // allowed: practitionerC's notice is 1h right now, comfortable margin above that
check("setup booking (3h ahead, practitionerC) created", !!inside.booking);
// Raise the notice AFTER the booking exists — the booking now sits
// inside practitionerC's cutoff, same as a real booking that was made
// with enough lead time but has since drifted inside the window as
// time passed.
await practitionerC.supabase.from("practitioner_profiles").update({ min_notice_hours: 24 }).eq("id", practitionerC.user.id);
const insideCancel = await client1.supabase
  .from("bookings")
  .update({ status: "cancelled_by_client" })
  .eq("id", inside.booking?.id ?? "")
  .eq("client_id", client1.user.id)
  .select();
check("client1's cancellation within the cutoff is rejected (zero rows, not an error)", (insideCancel.data ?? []).length === 0);
const stillConfirmed = await practitionerC.supabase.from("bookings").select("status").eq("id", inside.booking?.id ?? "").single();
check("the within-cutoff booking is untouched (still confirmed)", stillConfirmed.data?.status === "confirmed");

console.log("\n=== 3. Client cannot cancel ANOTHER client's booking ===");
const other = await bookAsClient(client2, practitionerA, serviceA, 44);
check("setup booking for client2 created", !!other.booking);
const crossCancel = await client1.supabase
  .from("bookings")
  .update({ status: "cancelled_by_client" })
  .eq("id", other.booking?.id ?? "")
  .eq("client_id", client2.user.id)
  .select();
check("client1 cancelling client2's booking is rejected (zero rows)", (crossCancel.data ?? []).length === 0);

console.log("\n=== 4. Client cannot smuggle a 'cancelled_by_practitioner' status onto their own booking ===");
const forgedStatus = await bookAsClient(client1, practitionerA, serviceA, 48);
check("setup booking (48h ahead) created", !!forgedStatus.booking);
const forgedStatusUpdate = await client1.supabase
  .from("bookings")
  .update({ status: "cancelled_by_practitioner" })
  .eq("id", forgedStatus.booking?.id ?? "")
  .eq("client_id", client1.user.id)
  .select();
check("client setting status to cancelled_by_practitioner on their own booking is rejected", (forgedStatusUpdate.data ?? []).length === 0);

console.log("\n=== 5. Practitioner cancels their OWN booking WITHIN the client's cutoff (succeeds — emergency case) ===");
// Lower the notice again so this near-term insert is even possible,
// same as step 2's setup — then raise it right back so the
// cancellation itself is genuinely tested within a real cutoff. Uses a
// distinct offset from step 2's booking (also on practitionerC) so the
// two don't collide via the double-booking exclusion constraint.
await practitionerC.supabase.from("practitioner_profiles").update({ min_notice_hours: 1 }).eq("id", practitionerC.user.id);
const emergency = await bookAsClient(client1, practitionerC, serviceC, 6);
check("setup booking (6h ahead, practitionerC) created", !!emergency.booking);
await practitionerC.supabase.from("practitioner_profiles").update({ min_notice_hours: 24 }).eq("id", practitionerC.user.id);
const emergencyCancel = await practitionerC.supabase
  .from("bookings")
  .update({ status: "cancelled_by_practitioner" })
  .eq("id", emergency.booking?.id ?? "")
  .eq("practitioner_id", practitionerC.user.id)
  .select();
check("practitionerC's cancellation within the cutoff succeeds (no cutoff applies to them)", (emergencyCancel.data ?? []).length === 1);
check("resulting status is cancelled_by_practitioner", emergencyCancel.data?.[0]?.status === "cancelled_by_practitioner");

console.log("\n=== 6. Practitioner cannot cancel ANOTHER practitioner's booking ===");
const forPracOwnershipTest = await bookAsClient(client1, practitionerA, serviceA, 52);
check("setup active booking for the ownership test created", !!forPracOwnershipTest.booking);
const crossPracCancel = await practitionerB.supabase
  .from("bookings")
  .update({ status: "cancelled_by_practitioner" })
  .eq("id", forPracOwnershipTest.booking?.id ?? "")
  .eq("practitioner_id", practitionerA.user.id)
  .select();
check("practitionerB cancelling practitionerA's booking is rejected (zero rows)", (crossPracCancel.data ?? []).length === 0);

console.log("\n=== 7. An UPDATE touching a column besides `status` is rejected outright (column-level GRANT) ===");
const smuggledColumn = await client1.supabase
  .from("bookings")
  .update({ status: "cancelled_by_client", start_utc: new Date(Date.now() + 96 * 60 * 60 * 1000).toISOString() })
  .eq("id", forgedStatus.booking?.id ?? "")
  .eq("client_id", client1.user.id)
  .select();
check("an UPDATE that also touches start_utc is rejected by the column grant (an error, not silent partial success)", !!smuggledColumn.error);
const unchanged = await practitionerA.supabase.from("bookings").select("start_utc, status").eq("id", forgedStatus.booking?.id ?? "").single();
check(
  "the row's start_utc and status are both untouched after the rejected smuggle attempt",
  new Date(unchanged.data?.start_utc ?? 0).getTime() === new Date(forgedStatus.slot.start).getTime() &&
    unchanged.data?.status === "confirmed",
);

console.log("\n=== 8. A direct-API booking insert INSIDE the notice window is rejected ===");
const tooSoonSlot = slotFor(2, serviceA.duration_minutes); // 2h ahead, inside practitionerA's 24h default
const tooSoonInsert = await client1.supabase.from("bookings").insert({
  practitioner_id: practitionerA.user.id,
  client_id: client1.user.id,
  service_id: serviceA.id,
  start_utc: tooSoonSlot.start,
  end_utc: tooSoonSlot.end,
}).select();
check("an insert starting inside the notice window is rejected by the widened INSERT policy", !!tooSoonInsert.error);

console.log("\n=== 9. Cancelling actually frees the slot (get_practitioner_busy_times no longer reports it) ===");
const freeToCancel = await bookAsClient(client2, practitionerA, serviceA, 56);
check("setup booking (56h ahead) for slot-freeing test created", !!freeToCancel.booking);
const busyBefore = await practitionerA.supabase.rpc("get_practitioner_busy_times", {
  target_practitioner_id: practitionerA.user.id,
  window_start: new Date().toISOString(),
  window_end: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
});
const wasBusy = (busyBefore.data ?? []).some((b) => new Date(b.start_utc).getTime() === new Date(freeToCancel.slot.start).getTime());
check("the slot shows as busy before cancellation", wasBusy);

await client2.supabase
  .from("bookings")
  .update({ status: "cancelled_by_client" })
  .eq("id", freeToCancel.booking?.id ?? "")
  .eq("client_id", client2.user.id);

const busyAfter = await practitionerA.supabase.rpc("get_practitioner_busy_times", {
  target_practitioner_id: practitionerA.user.id,
  window_start: new Date().toISOString(),
  window_end: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
});
const stillBusy = (busyAfter.data ?? []).some((b) => new Date(b.start_utc).getTime() === new Date(freeToCancel.slot.start).getTime());
check("the slot no longer shows as busy after cancellation — it's genuinely freed", !stillBusy);

console.log(`\n=== RESULT: ${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`} ===`);
process.exit(failures === 0 ? 0 : 1);
