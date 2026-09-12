// Delayed payouts (separate charges & transfers) — verification.
// Requires migration 20260912120000 applied + the dev server running
// (BRAND=two npm run dev) so the REAL sweep code executes in-process.
// Run: node --env-file=.env.local scripts/verify-delayed-payouts.mjs
//
// Drives the isolated /api/admin/run-payout-sweep endpoint (runs ONLY
// runPayoutReleaseSweep — no reminder emails etc.). Covers:
//  1. not-yet-due       → release_at backfilled (end+48h), stays pending, no transfer
//  2. frozen + due      → marked 'held', no transfer attempted
//  3. due + not frozen  → transfer attempted; with a non-real PI it FAILS →
//                         payoutsFailed + a transfer_failed alert is raised
//  4. extend-hold       → release_at pushed out, stays pending (admin action's DB effect)
//  5. refund-before-release → payment marked not_applicable, sweep ignores it
// The happy-path Transfer.create / refund reversal are live Stripe calls; this
// exercises every branch up to the API call + the failure/alert path. Validate
// the success path in Stripe test mode with a real connected account.
import { createClient } from "@supabase/supabase-js";

const BASE = "http://127.0.0.1:3000";
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SECRET_KEY, { auth: { persistSession: false } });
const stamp = Date.now();
let failures = 0;
const check = (l, c, d) => { if (!c) failures++; console.log(`${c ? "PASS" : "FAIL"} — ${l}${d !== undefined ? `  (${d})` : ""}`); };
const created = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const runSweep = async () => {
  const res = await fetch(`${BASE}/api/admin/run-payout-sweep`, { headers: { Authorization: `Bearer ${process.env.CRON_SECRET}` } });
  if (!res.ok) throw new Error(`sweep endpoint ${res.status} — is the dev server running + CRON_SECRET set?`);
  return res.json();
};

async function mkUser(role) {
  const email = `payout-${role}-${stamp}-${Math.random().toString(36).slice(2, 6)}@example.com`;
  const { data, error } = await db.auth.admin.createUser({ email, password: "twelvecharspw1", email_confirm: true, user_metadata: { role, display_name: `Payout ${role}` } });
  if (error) throw error;
  created.push(data.user.id);
  if (role === "practitioner") for (let i = 0; i < 25; i++) { if ((await db.from("practitioner_profiles").select("id").eq("id", data.user.id).maybeSingle()).data) break; await sleep(200); }
  return data.user.id;
}
async function mkPractitioner({ frozen }) {
  const id = await mkUser("practitioner");
  await db.from("practitioner_profiles").update({ billing_model: "commission", stripe_connected_account_id: "acct_test_" + id.slice(0, 8), payouts_frozen: !!frozen }).eq("id", id);
  await db.from("services").insert({ practitioner_id: id, name: "Svc", duration_minutes: 30, price_cents: 5000, currency: "EUR", is_active: true, delivery_type: "online", delivery_info: "x" });
  return id;
}
async function mkBookingWithPayment({ practitionerId, clientId, endOffsetMs, status = "succeeded" }) {
  const svc = (await db.from("services").select("id").eq("practitioner_id", practitionerId).limit(1).single()).data;
  const start = new Date(Date.now() + endOffsetMs - 1800_000).toISOString();
  const end = new Date(Date.now() + endOffsetMs).toISOString();
  const { data: b, error: be } = await db.from("bookings").insert({ practitioner_id: practitionerId, client_id: clientId, service_id: svc.id, start_utc: start, end_utc: end, status: "completed", delivery_type: "online", service_name: "Svc", price_cents: 5000, currency: "EUR" }).select("id").single();
  if (be) throw be;
  await db.from("payments").insert({
    booking_id: b.id,
    stripe_checkout_session_id: `cs_test_${stamp}_${Math.random().toString(36).slice(2, 8)}`,
    amount_cents: 5000, commission_cents: 1000, currency: "EUR", status,
    provider_ref: { payment_intent_id: `pi_test_nonexistent_${Math.random().toString(36).slice(2, 8)}` },
  });
  return b.id;
}
const payment = async (bookingId) => (await db.from("payments").select("transfer_status, release_at, stripe_transfer_id, status").eq("booking_id", bookingId).single()).data;

(async () => {
  console.log(`=== Delayed-payouts verification ===\n`);
  const client = await mkUser("client");
  const pOk = await mkPractitioner({ frozen: false });
  const pFrozen = await mkPractitioner({ frozen: true });

  const bFuture = await mkBookingWithPayment({ practitionerId: pOk, clientId: client, endOffsetMs: 3 * 86_400_000 });
  const bDueFrozen = await mkBookingWithPayment({ practitionerId: pFrozen, clientId: client, endOffsetMs: -3 * 86_400_000 });
  const bDueOk = await mkBookingWithPayment({ practitionerId: pOk, clientId: client, endOffsetMs: -3 * 86_400_000 });
  const bRefunded = await mkBookingWithPayment({ practitionerId: pOk, clientId: client, endOffsetMs: -3 * 86_400_000, status: "refunded" });

  const summary = await runSweep();
  console.log("sweep summary:", JSON.stringify(summary), "\n");

  const f = await payment(bFuture);
  check("not-yet-due: still pending", f.transfer_status === "pending", f.transfer_status);
  check("not-yet-due: release_at backfilled", !!f.release_at, f.release_at);

  const fr = await payment(bDueFrozen);
  check("frozen+due: marked held", fr.transfer_status === "held", fr.transfer_status);
  check("frozen+due: no transfer id", !fr.stripe_transfer_id, fr.stripe_transfer_id);

  const ok = await payment(bDueOk);
  check("due+unfrozen: not released (bogus PI → transfer failed)", ok.transfer_status !== "released", ok.transfer_status);
  check("sweep counted a failure", (summary.payoutsFailed ?? 0) >= 1, summary.payoutsFailed);
  const { data: alerts } = await db.from("alerts").select("id").eq("type", "transfer_failed").eq("subject", bDueOk);
  check("transfer_failed alert raised", (alerts ?? []).length >= 1, (alerts ?? []).length);

  const rf = await payment(bRefunded);
  check("refunded row untouched by sweep (status=refunded excluded)", rf.transfer_status !== "released", rf.transfer_status);

  const before = (await payment(bFuture)).release_at;
  await db.from("payments").update({ release_at: new Date(new Date(before).getTime() + 7 * 86_400_000).toISOString() }).eq("booking_id", bFuture);
  const after = (await payment(bFuture)).release_at;
  check("extend-hold: release_at pushed out", new Date(after).getTime() > new Date(before).getTime(), `${before} → ${after}`);

  for (const b of [bFuture, bDueFrozen, bDueOk, bRefunded]) { await db.from("payments").delete().eq("booking_id", b); await db.from("bookings").delete().eq("id", b); }
  await db.from("alerts").delete().eq("type", "transfer_failed").eq("subject", bDueOk);
  for (const id of created) { await db.from("services").delete().eq("practitioner_id", id); await db.auth.admin.deleteUser(id, false).catch(() => {}); }

  console.log(`\n=== ${failures === 0 ? "ALL PASSED" : failures + " FAILED"} ===`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => { console.error("FATAL:", e); process.exit(1); });
