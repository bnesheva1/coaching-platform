// Epic 6, final sub-slice: proves get_reminder_batch is uncallable with
// the anon/publishable key — it's granted to service_role only, not
// authenticated or anon, so this should be rejected by Postgres' own
// grant system before the function body (which has no auth.uid() check
// at all, unlike every other RPC in this app) ever runs. Also confirms
// the new marker columns exist and are readable by a booking's own
// party (schema sanity, not a security check — reading your own
// booking's reminder-sent timestamps isn't sensitive).
//
// Note: this script deliberately does NOT use the service-role key —
// that's the point. A real end-to-end reminder-send test needs the
// actual cron route (see the manual verification step in the plan).
//
// Run: node --env-file=.env.local scripts/verify-reminder-batch-security.mjs

import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const password = "twelvecharspw1";
const stamp = Date.now();

async function signUp(role, name) {
  const supabase = createClient(url, key);
  const email = `reminderbatch-${role}-${stamp}-${Math.random().toString(36).slice(2, 6)}@example.com`;
  const { data } = await supabase.auth.signUp({
    email, password, options: { data: { role, display_name: name, locale: "en" } },
  });
  return { supabase, user: data.user };
}

let failures = 0;
function check(label, condition) {
  console.log(`${condition ? "PASS" : "FAIL"} — ${label}`);
  if (!condition) failures++;
}

console.log("=== Setup ===");
const practitionerA = await signUp("practitioner", `ReminderBatchPracA ${stamp}`);
const client1 = await signUp("client", `ReminderBatchClient1 ${stamp}`);
await new Promise((r) => setTimeout(r, 500));

const usernameA = `reminderbatchA${stamp}`;
await practitionerA.supabase.from("practitioner_profiles").update({ username: usernameA }).eq("id", practitionerA.user.id);

// .select("id, duration_minutes") only — delivery_info is excluded
// from the column grant, and a bare .select() implicitly requests
// every granted-visible column via RETURNING.
const { data: service } = await practitionerA.supabase
  .from("services")
  .insert({ practitioner_id: practitionerA.user.id, name: "Reminder Batch Test Svc", duration_minutes: 30, price_cents: 1000, currency: "EUR", is_active: true, delivery_type: "online", delivery_info: "https://example.com/meeting" })
  .select("id, duration_minutes").single();

// 26h, not exactly 24h — a razor-thin margin above the practitioner's
// default 24h min_notice_hours would fail the INSERT policy's own
// >= 24h check by the time this reaches the DB a few ms later.
const startUtc = new Date(Date.now() + 26 * 60 * 60 * 1000).toISOString();
const endUtc = new Date(new Date(startUtc).getTime() + service.duration_minutes * 60 * 1000).toISOString();
const { data: booking } = await client1.supabase.from("bookings").insert({
  practitioner_id: practitionerA.user.id, client_id: client1.user.id, service_id: service.id,
  start_utc: startUtc, end_utc: endUtc,
}).select().single();
check("setup booking created", !!booking);

console.log("\n=== 1. get_reminder_batch is uncallable with the anon/publishable key ===");
const anon = createClient(url, key);
const anonCall = await anon.rpc("get_reminder_batch", {
  window_start: new Date().toISOString(),
  window_end: new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString(),
  batch_limit: 10,
});
check("anon calling get_reminder_batch is rejected (no grant, not just no rows)", !!anonCall.error);

console.log("\n=== 2. An authenticated user (even a real party to a real booking) also cannot call it ===");
const clientCall = await client1.supabase.rpc("get_reminder_batch", {
  window_start: new Date().toISOString(),
  window_end: new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString(),
  batch_limit: 10,
});
check("client1 (authenticated, even a real booking party) is also rejected — service_role only", !!clientCall.error);

console.log("\n=== 3. The new marker columns exist and are readable by the booking's own party (schema sanity) ===");
const ownRead = await client1.supabase.from("bookings").select("client_reminder_sent_at, practitioner_reminder_sent_at").eq("id", booking.id).single();
check("columns exist and are both null on a freshly created booking", !ownRead.error && ownRead.data?.client_reminder_sent_at === null && ownRead.data?.practitioner_reminder_sent_at === null);

console.log(`\n=== RESULT: ${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`} ===`);
process.exit(failures === 0 ? 0 : 1);
