// Epic 8, part 2: reviews. Proves the reviews INSERT RLS policy is the
// entire authenticity gate (only a client with a completed booking for
// THEMSELVES can review it, once), and that pseudonymity is structural,
// not UI-hidden — booking_id is not selectable by ANYONE via a direct
// query, including the reviewing client's own account and the reviewed
// practitioner.
//
// Bookings here are seeded directly via the service-role client (not
// through the normal booking flow), since a 'completed' booking can
// only otherwise arise via the passage of real time through the cron
// job — see scripts/verify-booking-completion.mjs for that mechanism
// tested in isolation.
//
// Run: node --env-file=.env.local scripts/verify-reviews-security.mjs

import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const serviceKey = process.env.SUPABASE_SECRET_KEY;
const password = "twelvecharspw1";
const stamp = Date.now();

const serviceRole = createClient(url, serviceKey);

async function signUp(role, name) {
  const supabase = createClient(url, anonKey);
  const email = `reviews-${role}-${stamp}-${Math.random().toString(36).slice(2, 6)}@example.com`;
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
const practitionerA = await signUp("practitioner", `ReviewsPracA ${stamp}`);
const client1 = await signUp("client", `ReviewsClient1 ${stamp}`);
const client2 = await signUp("client", `ReviewsClient2 ${stamp}`);
await new Promise((r) => setTimeout(r, 500));

const usernameA = `reviewsA${stamp}`;
await practitionerA.supabase.from("practitioner_profiles").update({ username: usernameA }).eq("id", practitionerA.user.id);

const { data: service } = await practitionerA.supabase
  .from("services")
  .insert({ practitioner_id: practitionerA.user.id, name: "Reviews Test Svc", duration_minutes: 30, price_cents: 1000, currency: "EUR", is_active: true, delivery_type: "online", delivery_info: "https://example.com/meeting" })
  .select("id, duration_minutes").single();

// Seeded via service-role — bypasses both RLS and the normal
// min-notice-hours INSERT policy, which a real completed booking (one
// whose time has already passed) could never satisfy through the
// ordinary client-facing insert path. Distinct hoursAgo offsets keep
// these from colliding via the double-booking exclusion constraint.
async function seedBooking(client, status, hoursAgo) {
  const start = new Date(Date.now() - hoursAgo * 60 * 60 * 1000).toISOString();
  const end = new Date(new Date(start).getTime() + service.duration_minutes * 60 * 1000).toISOString();
  const { data, error } = await serviceRole.from("bookings").insert({
    practitioner_id: practitionerA.user.id,
    client_id: client.user.id,
    service_id: service.id,
    start_utc: start,
    end_utc: end,
    status,
  }).select("id").single();
  if (error) console.error("seedBooking failed:", error);
  return data;
}

const bookingCompleted = await seedBooking(client1, "completed", 48);
const bookingPending = await seedBooking(client1, "pending", 46);
const bookingCancelled = await seedBooking(client1, "cancelled_by_client", 44);
const bookingCompletedOtherClient = await seedBooking(client2, "completed", 42);

check("bookingCompleted seeded", !!bookingCompleted);
check("bookingPending seeded", !!bookingPending);
check("bookingCancelled seeded", !!bookingCancelled);
check("bookingCompletedOtherClient seeded", !!bookingCompletedOtherClient);

async function attemptReview(client, bookingId, rating = 5) {
  return client.supabase.from("reviews").insert({
    booking_id: bookingId,
    practitioner_id: practitionerA.user.id,
    rating,
    review_text: "Great session",
  }).select("id").single();
}

console.log("\n=== 1. A client cannot review a booking that isn't completed (pending) ===");
const pendingAttempt = await attemptReview(client1, bookingPending?.id);
check("reviewing a pending booking is rejected", !!pendingAttempt.error);

console.log("\n=== 2. A client cannot review a cancelled booking ===");
const cancelledAttempt = await attemptReview(client1, bookingCancelled?.id);
check("reviewing a cancelled booking is rejected", !!cancelledAttempt.error);

console.log("\n=== 3. A client cannot review someone ELSE's completed booking ===");
const wrongClientAttempt = await attemptReview(client1, bookingCompletedOtherClient?.id);
check("client1 reviewing client2's completed booking is rejected", !!wrongClientAttempt.error);

console.log("\n=== 4. A practitioner cannot fabricate a review for their own service (they're never the client on any booking) ===");
const practitionerAttempt = await practitionerA.supabase.from("reviews").insert({
  booking_id: bookingCompleted?.id,
  practitioner_id: practitionerA.user.id,
  rating: 5,
}).select("id").single();
check("practitionerA attempting to review a booking they're the practitioner (not client) on is rejected", !!practitionerAttempt.error);

console.log("\n=== 5. A client CAN review their own completed booking ===");
const validReview = await attemptReview(client1, bookingCompleted?.id);
check("client1 reviewing their own completed booking succeeds", !validReview.error && !!validReview.data);

console.log("\n=== 6. A client cannot review the SAME booking twice ===");
const doubleReview = await attemptReview(client1, bookingCompleted?.id);
check("a second review for the same booking is rejected", !!doubleReview.error);
check("the rejection is specifically the unique constraint (23505), not something else", doubleReview.error?.code === "23505");

console.log("\n=== 7. Pseudonymity: booking_id is not selectable via direct query, by ANYONE ===");
const anon = createClient(url, anonKey);
const anonSelect = await anon.from("reviews").select("booking_id").eq("id", validReview.data?.id ?? "");
check("anon selecting booking_id is rejected (column not granted)", !!anonSelect.error);

const uninvolvedSelect = await client2.supabase.from("reviews").select("booking_id").eq("id", validReview.data?.id ?? "");
check("an uninvolved client selecting booking_id is rejected", !!uninvolvedSelect.error);

const reviewerOwnSelect = await client1.supabase.from("reviews").select("booking_id").eq("id", validReview.data?.id ?? "");
check("the reviewing client themselves selecting booking_id is rejected — the core pseudonymity proof", !!reviewerOwnSelect.error);

const practitionerSelect = await practitionerA.supabase.from("reviews").select("booking_id").eq("id", validReview.data?.id ?? "");
check("the reviewed practitioner selecting booking_id is rejected", !!practitionerSelect.error);

console.log("\n=== 7b. reviewer_display_name gets the identical treatment — stored, never selectable ===");
const anonNameSelect = await anon.from("reviews").select("reviewer_display_name").eq("id", validReview.data?.id ?? "");
check("anon selecting reviewer_display_name is rejected", !!anonNameSelect.error);

const reviewerOwnNameSelect = await client1.supabase.from("reviews").select("reviewer_display_name").eq("id", validReview.data?.id ?? "");
check("the reviewing client themselves selecting reviewer_display_name is rejected", !!reviewerOwnNameSelect.error);

const practitionerNameSelect = await practitionerA.supabase.from("reviews").select("reviewer_display_name").eq("id", validReview.data?.id ?? "");
check("the reviewed practitioner selecting reviewer_display_name is rejected", !!practitionerNameSelect.error);

// select(*) is stricter than expected, in the app's favor: PostgREST
// issues a literal `select *` against the table, and Postgres rejects
// the whole query outright (42501, permission denied) rather than
// silently returning a row with booking_id omitted — confirmed via a
// standalone check against the live DB. So the correct expectation
// here is an error, same as the explicit column selects above, not a
// partial row.
const starSelect = await anon.from("reviews").select("*").eq("id", validReview.data?.id ?? "");
check("select(*) is also rejected outright, not silently missing booking_id", !!starSelect.error);

console.log("\n=== 8. Public columns ARE readable (positive control — the restriction is scoped, not total) ===");
const publicRead = await anon
  .from("reviews")
  .select("id, rating, review_text, practitioner_id, created_at")
  .eq("id", validReview.data?.id ?? "")
  .single();
check("anon can read the public review shape", !publicRead.error && publicRead.data?.rating === 5);

console.log("\n=== 9. get_my_reviewed_booking_ids scopes to the caller's own bookings only ===");
const client1Reviewed = await client1.supabase.rpc("get_my_reviewed_booking_ids");
check(
  "client1 sees exactly their one reviewed booking",
  (client1Reviewed.data ?? []).length === 1 && client1Reviewed.data[0].booking_id === bookingCompleted?.id,
);

const client2Reviewed = await client2.supabase.rpc("get_my_reviewed_booking_ids");
check("client2 (who hasn't reviewed anything) sees none", (client2Reviewed.data ?? []).length === 0);

console.log(`\n=== RESULT: ${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`} ===`);
process.exit(failures === 0 ? 0 : 1);
