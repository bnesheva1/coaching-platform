// Epic 8, part 1: session completion. Proves the actual completion
// mechanism — the UPDATE that lib/bookings/completePastBookings.ts
// runs — correctly flips a past, non-cancelled booking to 'completed',
// and correctly leaves cancelled and future bookings alone. Tests the
// mechanism directly via the service-role client (mirrors the query in
// completePastBookings.ts) rather than importing that TS module, which
// isn't resolvable from a plain node script — same approach as
// verify-reminder-batch-security.mjs; a real end-to-end run is the
// manual cron-trigger step in the plan.
//
// Run: node --env-file=.env.local scripts/verify-booking-completion.mjs

import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const serviceKey = process.env.SUPABASE_SECRET_KEY;
const password = "twelvecharspw1";
const stamp = Date.now();

const serviceRole = createClient(url, serviceKey);

async function signUp(role, name) {
  const supabase = createClient(url, anonKey);
  const email = `bookcomplete-${role}-${stamp}-${Math.random().toString(36).slice(2, 6)}@example.com`;
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
const practitioner = await signUp("practitioner", `BookCompletePrac ${stamp}`);
const client1 = await signUp("client", `BookCompleteClient1 ${stamp}`);
await new Promise((r) => setTimeout(r, 500));

const username = `bookcomplete${stamp}`;
await practitioner.supabase.from("practitioner_profiles").update({ username }).eq("id", practitioner.user.id);

const { data: service } = await practitioner.supabase
  .from("services")
  .insert({ practitioner_id: practitioner.user.id, name: "Completion Test Svc", duration_minutes: 30, price_cents: 1000, currency: "EUR", is_active: true, delivery_type: "online", delivery_info: "https://example.com/meeting" })
  .select("id, duration_minutes").single();

// Seeded via service-role, same reasoning as verify-reviews-security.mjs:
// a real past-dated booking can't be created through the normal
// client-facing insert path (the min-notice-hours INSERT policy
// requires start_utc in the future).
async function seedBooking(status, hoursOffset) {
  const start = new Date(Date.now() + hoursOffset * 60 * 60 * 1000).toISOString();
  const end = new Date(new Date(start).getTime() + service.duration_minutes * 60 * 1000).toISOString();
  const { data, error } = await serviceRole.from("bookings").insert({
    practitioner_id: practitioner.user.id,
    client_id: client1.user.id,
    service_id: service.id,
    start_utc: start,
    end_utc: end,
    status,
  }).select("id").single();
  if (error) console.error("seedBooking failed:", error);
  return data;
}

const pastConfirmed = await seedBooking("confirmed", -5); // ended in the past
const pastCancelled = await seedBooking("cancelled_by_client", -7); // ended in the past, but cancelled
const futureConfirmed = await seedBooking("confirmed", 5); // still upcoming

check("pastConfirmed seeded", !!pastConfirmed);
check("pastCancelled seeded", !!pastCancelled);
check("futureConfirmed seeded", !!futureConfirmed);

console.log("\n=== Running the completion UPDATE (mirrors lib/bookings/completePastBookings.ts) ===");
const { data: completedRows, error: updateError } = await serviceRole
  .from("bookings")
  .update({ status: "completed" })
  .in("status", ["pending", "confirmed"])
  .lt("end_utc", new Date().toISOString())
  .select("id");
check("the UPDATE runs without error", !updateError);

console.log("\n=== 1. A past, non-cancelled booking flips to 'completed' ===");
const { data: afterPastConfirmed } = await practitioner.supabase.from("bookings").select("status").eq("id", pastConfirmed?.id ?? "").single();
check("pastConfirmed is now completed", afterPastConfirmed?.status === "completed");
check("pastConfirmed's id is in the UPDATE's returned rows", (completedRows ?? []).some((r) => r.id === pastConfirmed?.id));

console.log("\n=== 2. A past, CANCELLED booking does NOT flip — cancellation permanently excludes it ===");
const { data: afterPastCancelled } = await practitioner.supabase.from("bookings").select("status").eq("id", pastCancelled?.id ?? "").single();
check("pastCancelled is still cancelled_by_client, not completed", afterPastCancelled?.status === "cancelled_by_client");

console.log("\n=== 3. A future booking does NOT flip — the session hasn't happened yet ===");
const { data: afterFutureConfirmed } = await practitioner.supabase.from("bookings").select("status").eq("id", futureConfirmed?.id ?? "").single();
check("futureConfirmed is still confirmed, not completed", afterFutureConfirmed?.status === "confirmed");

console.log(`\n=== RESULT: ${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`} ===`);
process.exit(failures === 0 ? 0 : 1);
