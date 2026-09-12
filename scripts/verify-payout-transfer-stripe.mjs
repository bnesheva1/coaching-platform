// Delayed payouts — LIVE Stripe test-mode regression test.
// Exercises the actual stripe.transfers.create (via the real release sweep) and
// the reversal + refund calls against a REAL test-mode connected account —
// the part scripts/verify-delayed-payouts.mjs stops short of.
//
// Requires: STRIPE_SECRET_KEY in TEST mode, the BRAND=two dev server running
// (for /api/admin/run-payout-sweep), CRON_SECRET set, and at least one
// transfer-active test connected account on file (e.g. an onboarded test
// practitioner). Run: node --env-file=.env.local scripts/verify-payout-transfer-stripe.mjs
import { createClient } from "@supabase/supabase-js";
import Stripe from "stripe";

const BASE = "http://127.0.0.1:3000";
const key = process.env.STRIPE_SECRET_KEY || "";
if (!key.includes("_test_")) { console.error("Refusing to run: STRIPE_SECRET_KEY is not a test key."); process.exit(1); }
const stripe = new Stripe(key);
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SECRET_KEY, { auth: { persistSession: false } });
const stamp = Date.now();
let failures = 0;
const created = [];
const check = (l, c, d) => { if (!c) failures++; console.log(`${c ? "PASS" : "FAIL"} — ${l}${d !== undefined ? `  (${d})` : ""}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Find a real, transfer-active test connected account to use as the destination.
async function findTransferActiveAccount() {
  const { data } = await db.from("practitioner_profiles").select("stripe_connected_account_id").eq("stripe_connect_transfers_active", true).not("stripe_connected_account_id", "is", null);
  for (const r of data ?? []) {
    try {
      const acct = await stripe.accounts.retrieve(r.stripe_connected_account_id);
      if (acct.capabilities?.transfers === "active") return acct.id;
    } catch { /* fake/deleted id — skip */ }
  }
  return null;
}

(async () => {
  console.log("=== Delayed-payouts LIVE Stripe test-mode regression ===\n");
  const destination = await findTransferActiveAccount();
  if (!destination) {
    console.error("SKIP: no transfer-active test connected account on file. Onboard a test practitioner (Stripe test dashboard) and re-run.");
    process.exit(2);
  }
  console.log("destination account:", destination);

  // 1. Real charge to the platform balance (test card), so the transfer has a
  //    settled source_transaction to draw from.
  const pi = await stripe.paymentIntents.create({
    amount: 5000, currency: "eur", payment_method: "pm_card_visa", confirm: true,
    automatic_payment_methods: { enabled: true, allow_redirects: "never" },
  });
  check("test charge succeeded", pi.status === "succeeded", pi.status);

  // 2. Seed a commission practitioner pointing at the transfer-active account,
  //    plus a due booking + a paid, pending payout referencing the real PI.
  const email = `payoutlive-practitioner-${stamp}@example.com`;
  const { data: mk, error: mkErr } = await db.auth.admin.createUser({ email, password: "twelvecharspw1", email_confirm: true, user_metadata: { role: "practitioner", display_name: "Payout Live" } });
  if (mkErr) throw mkErr;
  const pracId = mk.user.id; created.push(pracId);
  for (let i = 0; i < 25; i++) { if ((await db.from("practitioner_profiles").select("id").eq("id", pracId).maybeSingle()).data) break; await sleep(200); }
  await db.from("practitioner_profiles").update({ billing_model: "commission", stripe_connected_account_id: destination, payouts_frozen: false }).eq("id", pracId);
  await db.from("services").insert({ practitioner_id: pracId, name: "Svc", duration_minutes: 30, price_cents: 5000, currency: "EUR", is_active: true, delivery_type: "online", delivery_info: "x" });

  const clientEmail = `payoutlive-client-${stamp}@example.com`;
  const { data: mkc } = await db.auth.admin.createUser({ email: clientEmail, password: "twelvecharspw1", email_confirm: true, user_metadata: { role: "client", display_name: "Client" } });
  const clientId = mkc.user.id; created.push(clientId);

  const svc = (await db.from("services").select("id").eq("practitioner_id", pracId).limit(1).single()).data;
  const end = new Date(Date.now() - 3 * 86_400_000).toISOString();
  const start = new Date(Date.now() - 3 * 86_400_000 - 1800_000).toISOString();
  const { data: booking } = await db.from("bookings").insert({ practitioner_id: pracId, client_id: clientId, service_id: svc.id, start_utc: start, end_utc: end, status: "completed", delivery_type: "online", service_name: "Svc", price_cents: 5000, currency: "EUR" }).select("id").single();
  await db.from("payments").insert({
    booking_id: booking.id, stripe_checkout_session_id: `cs_live_${stamp}`,
    amount_cents: 5000, commission_cents: 1000, currency: "EUR", status: "succeeded",
    provider_ref: { payment_intent_id: pi.id },
  });

  // 3. Run the REAL sweep → it should create the Transfer (share = 4000).
  const res = await fetch(`${BASE}/api/admin/run-payout-sweep`, { headers: { Authorization: `Bearer ${process.env.CRON_SECRET}` } });
  if (!res.ok) throw new Error(`sweep endpoint ${res.status} — dev server running + CRON_SECRET set?`);
  console.log("sweep summary:", JSON.stringify(await res.json()));

  const paid = (await db.from("payments").select("transfer_status, stripe_transfer_id").eq("booking_id", booking.id).single()).data;
  check("payout released by sweep", paid.transfer_status === "released", paid.transfer_status);
  check("stripe_transfer_id recorded", !!paid.stripe_transfer_id, paid.stripe_transfer_id);

  let transferId = paid.stripe_transfer_id;
  if (transferId) {
    const tr = await stripe.transfers.retrieve(transferId);
    check("Transfer object exists in Stripe", !!tr.id, tr.id);
    check("Transfer amount = practitioner share (4000)", tr.amount === 4000, tr.amount);
    check("Transfer destination = the connected account", tr.destination === destination, tr.destination);

    // 4. Reversal + refund (the calls refund.ts makes after release) succeed on
    //    the real objects.
    const rev = await stripe.transfers.createReversal(transferId, { amount: 4000 });
    check("Transfer reversal created", !!rev.id, rev.id);
    const refund = await stripe.refunds.create({ payment_intent: pi.id });
    check("client charge refunded", refund.status === "succeeded" || refund.status === "pending", refund.status);
  } else {
    // No transfer → refund the charge so no test money is left uncaptured.
    await stripe.refunds.create({ payment_intent: pi.id }).catch(() => {});
  }

  // cleanup (DB only — the shared destination account is left intact)
  await db.from("payments").delete().eq("booking_id", booking.id);
  await db.from("bookings").delete().eq("id", booking.id);
  for (const id of created) { await db.from("services").delete().eq("practitioner_id", id); await db.auth.admin.deleteUser(id, false).catch(() => {}); }

  console.log(`\n=== ${failures === 0 ? "ALL PASSED" : failures + " FAILED"} ===`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => { console.error("FATAL:", e); process.exit(1); });
