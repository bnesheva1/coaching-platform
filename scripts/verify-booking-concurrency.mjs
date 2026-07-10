// Proves the double-booking guarantee is real, not just correct-looking
// SQL: two client accounts race a genuinely concurrent insert (via
// Promise.all, not sequential awaits) for the exact same practitioner +
// time range, and exactly one must survive.
//
// Tests the database mechanism directly (the same insert bookSlot
// performs) rather than through the Server Action itself — Server
// Actions use a private wire format not meant for scripting (established
// elsewhere in this project), and the actual race-safety guarantee lives
// entirely in the database's exclusion constraint, not in application
// code, so this is the correct level to verify it at.
//
// Run: node --env-file=.env.local scripts/verify-booking-concurrency.mjs

import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const password = "twelvecharspw1";
const stamp = Date.now();

async function signUp(role, name) {
  const supabase = createClient(url, key);
  const email = `bookrace-${role}-${stamp}-${Math.random().toString(36).slice(2, 6)}@example.com`;
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
const practitioner = await signUp("practitioner", `BookRacePrac ${stamp}`);
const clientA = await signUp("client", `BookRaceA ${stamp}`);
const clientB = await signUp("client", `BookRaceB ${stamp}`);
await new Promise((r) => setTimeout(r, 500));

const username = `bookrace${stamp}`;
await practitioner.supabase.from("practitioner_profiles").update({ username }).eq("id", practitioner.user.id);

const { data: service } = await practitioner.supabase
  .from("services")
  .insert({ practitioner_id: practitioner.user.id, name: "Race Test Svc", duration_minutes: 30, price_cents: 1000, currency: "EUR", is_active: true })
  .select()
  .single();

// A specific future instant — the exact same slot both clients will race for.
const startUtc = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
const endUtc = new Date(new Date(startUtc).getTime() + service.duration_minutes * 60 * 1000).toISOString();

console.log(`\n=== Racing two concurrent inserts for the exact same slot (${startUtc}) ===`);
const bookingFor = (client) => ({
  practitioner_id: practitioner.user.id,
  client_id: client.user.id,
  service_id: service.id,
  start_utc: startUtc,
  end_utc: endUtc,
});

const [resultA, resultB] = await Promise.all([
  clientA.supabase.from("bookings").insert(bookingFor(clientA)).select(),
  clientB.supabase.from("bookings").insert(bookingFor(clientB)).select(),
]);

const succeededA = !resultA.error && (resultA.data ?? []).length === 1;
const succeededB = !resultB.error && (resultB.data ?? []).length === 1;

console.log("Client A:", succeededA ? "succeeded" : `rejected (${resultA.error?.code}: ${resultA.error?.message?.slice(0, 60)})`);
console.log("Client B:", succeededB ? "succeeded" : `rejected (${resultB.error?.code}: ${resultB.error?.message?.slice(0, 60)})`);

check("exactly one of the two concurrent bookings succeeded", succeededA !== succeededB);

const loserResult = succeededA ? resultB : resultA;
check(
  "the loser was rejected specifically by the exclusion constraint (23P01), not some other error",
  loserResult.error?.code === "23P01",
);

console.log("\n=== Confirm exactly one row actually exists in the database ===");
const { data: allBookings } = await practitioner.supabase
  .from("bookings")
  .select("client_id")
  .eq("practitioner_id", practitioner.user.id)
  .eq("start_utc", startUtc);
check("exactly one booking row exists for this practitioner+time", (allBookings ?? []).length === 1);

console.log(`\n=== RESULT: ${failures === 0 ? "PASS — double-booking guarantee holds under real concurrency" : `${failures} CHECK(S) FAILED`} ===`);
process.exit(failures === 0 ? 0 : 1);
