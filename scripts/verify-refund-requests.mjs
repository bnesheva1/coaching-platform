// Client refund requests — RLS + constraint verification.
// Requires migration 20260913120000 applied.
// Run: node --env-file=.env.local scripts/verify-refund-requests.mjs
//
// Covers the security-critical DB layer: a client can create a request only for
// their OWN booking, one per booking, and 'other' requires text. (Admin
// approve/deny go through requireAdmin server actions + the fixture-proven
// refundBookingPayment; not driven here.)
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const db = createClient(url, process.env.SUPABASE_SECRET_KEY, { auth: { persistSession: false } });
const PW = "twelvecharspw1";
const stamp = Date.now();
let failures = 0;
const created = [];
const check = (l, c, d) => { if (!c) failures++; console.log(`${c ? "PASS" : "FAIL"} — ${l}${d !== undefined ? `  (${d})` : ""}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function mkUser(role) {
  const email = `refreq-${role}-${stamp}-${Math.random().toString(36).slice(2, 5)}@example.com`;
  const { data, error } = await db.auth.admin.createUser({ email, password: PW, email_confirm: true, user_metadata: { role, display_name: `Ref ${role}` } });
  if (error) throw error;
  created.push(data.user.id);
  if (role === "practitioner") for (let i = 0; i < 25; i++) { if ((await db.from("practitioner_profiles").select("id").eq("id", data.user.id).maybeSingle()).data) break; await sleep(200); }
  return { id: data.user.id, email };
}
async function userClient(email) {
  const c = createClient(url, anonKey, { auth: { persistSession: false } });
  const { error } = await c.auth.signInWithPassword({ email, password: PW });
  if (error) throw new Error("signIn: " + error.message);
  return c;
}

(async () => {
  console.log("=== Refund-requests RLS/constraint verification ===\n");
  const A = await mkUser("client");
  const B = await mkUser("client");
  const prac = await mkUser("practitioner");
  await db.from("practitioner_profiles").update({ billing_model: "commission" }).eq("id", prac.id);
  await db.from("services").insert({ practitioner_id: prac.id, name: "Svc", duration_minutes: 30, price_cents: 5000, currency: "EUR", is_active: true, delivery_type: "online", delivery_info: "x" });
  const svc = (await db.from("services").select("id").eq("practitioner_id", prac.id).limit(1).single()).data;
  const end = new Date(Date.now() - 86_400_000).toISOString();
  const start = new Date(Date.now() - 86_400_000 - 1800_000).toISOString();
  const { data: booking } = await db.from("bookings").insert({ practitioner_id: prac.id, client_id: A.id, service_id: svc.id, start_utc: start, end_utc: end, status: "completed", delivery_type: "online", service_name: "Svc", price_cents: 5000, currency: "EUR" }).select("id").single();

  const ca = await userClient(A.email);
  const cb = await userClient(B.email);

  // 1. Owner can create a request for their own booking.
  const ins1 = await ca.from("refund_requests").insert({ booking_id: booking.id, client_id: A.id, reason_type: "technical_failure" });
  check("owner creates request for own booking", !ins1.error, ins1.error?.message);

  // 2. Duplicate on the same booking is blocked (unique booking_id).
  const dup = await ca.from("refund_requests").insert({ booking_id: booking.id, client_id: A.id, reason_type: "other", reason_text: "again" });
  check("duplicate request blocked", !!dup.error, dup.error?.code);

  // 3. A different client CANNOT create a request for A's booking (RLS).
  const cross = await cb.from("refund_requests").insert({ booking_id: booking.id, client_id: B.id, reason_type: "technical_failure" });
  check("cross-client request rejected by RLS", !!cross.error, cross.error?.code ?? cross.error?.message);

  // 4. A client cannot spoof someone else's client_id.
  const spoof = await cb.from("refund_requests").insert({ booking_id: booking.id, client_id: A.id, reason_type: "technical_failure" });
  check("spoofed client_id rejected by RLS", !!spoof.error, spoof.error?.code ?? spoof.error?.message);

  // 5. 'other' without text violates the check constraint (fresh booking).
  const { data: b2 } = await db.from("bookings").insert({ practitioner_id: prac.id, client_id: A.id, service_id: svc.id, start_utc: start, end_utc: end, status: "completed", delivery_type: "online", service_name: "Svc", price_cents: 5000, currency: "EUR" }).select("id").single();
  const noText = await ca.from("refund_requests").insert({ booking_id: b2.id, client_id: A.id, reason_type: "other" });
  check("'other' without text rejected by check constraint", !!noText.error, noText.error?.code);

  // 6. Owner reads their own request (status view path).
  const { data: mine } = await ca.from("refund_requests").select("booking_id, status, reason_type").eq("booking_id", booking.id);
  check("owner reads own request (status=pending)", (mine ?? [])[0]?.status === "pending", JSON.stringify(mine));

  // cleanup
  await db.from("refund_requests").delete().in("booking_id", [booking.id, b2.id]);
  await db.from("bookings").delete().in("id", [booking.id, b2.id]);
  for (const id of created) { await db.from("services").delete().eq("practitioner_id", id); await db.auth.admin.deleteUser(id, false).catch(() => {}); }

  console.log(`\n=== ${failures === 0 ? "ALL PASSED" : failures + " FAILED"} ===`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => { console.error("FATAL:", e); process.exit(1); });
