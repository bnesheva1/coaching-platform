// Gated content — purchase→release runtime path (webhook + payout sweep),
// exercising the content code that was previously only type-checked. Drives the
// REAL /api/webhooks/stripe (a signed synthetic checkout.session.completed) and
// the REAL /api/admin/run-payout-sweep (the content pass). Requires the dev
// server running with STRIPE_WEBHOOK_SECRET + CRON_SECRET + STRIPE_SECRET_KEY.
//
// Run: node --env-file=.env.local scripts/verify-content-payment-e2e.mjs

import { createClient } from "@supabase/supabase-js";
import Stripe from "stripe";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SECRET_KEY, { auth: { persistSession: false } });
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const stamp = Date.now();
let failures = 0;
const check = (l, c, d) => { if (!c) failures++; console.log(`${c ? "PASS" : "FAIL"} — ${l}${d !== undefined ? `  (${d})` : ""}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const created = [];

async function mkUser(role) {
  const email = `content-e2e-${role}-${stamp}-${Math.random().toString(36).slice(2, 6)}@example.com`;
  const { data, error } = await db.auth.admin.createUser({ email, password: "twelvecharspw1", email_confirm: true, user_metadata: { role, display_name: `Content ${role}` } });
  if (error) throw error;
  created.push(data.user.id);
  if (role === "practitioner") for (let i = 0; i < 25; i++) { if ((await db.from("practitioner_profiles").select("id").eq("id", data.user.id).maybeSingle()).data) break; await sleep(200); }
  return data.user.id;
}
async function mkPractitioner({ frozen }) {
  const id = await mkUser("practitioner");
  await db.from("practitioner_profiles").update({ billing_model: "commission", stripe_connected_account_id: "acct_test_" + id.slice(0, 8), payouts_frozen: !!frozen }).eq("id", id);
  return id;
}
async function mkItem(pracId, title) {
  const { data } = await db.from("content_items").insert({ practitioner_id: pracId, type: "video_youtube", title, price_cents: 1500, currency: "EUR", youtube_video_id: "dQw4w9WgXcQ" }).select("id").single();
  return data.id;
}
async function mkPurchase(itemId, buyerId, pracId, { status, releaseAt, pi }) {
  const { data } = await db.from("content_purchases").insert({
    content_item_id: itemId, buyer_id: buyerId, practitioner_id: pracId, status,
    amount_cents: 1500, currency: "EUR", commission_rate: 0.15, commission_cents: 225,
    connected_account_id: "acct_test_" + pracId.slice(0, 8),
    ...(status === "completed" ? { purchased_at: new Date().toISOString(), transfer_status: "pending", release_at: releaseAt, stripe_payment_intent_id: pi } : {}),
  }).select("id").single();
  return data.id;
}

console.log("=== Setup ===");
const pracA = await mkPractitioner({ frozen: false });
const pracF = await mkPractitioner({ frozen: true });
const itemA = await mkItem(pracA, "E2E Video A");
const itemF = await mkItem(pracF, "E2E Video F");
const buyer1 = await mkUser("client");
const buyer2 = await mkUser("client");
const buyer3 = await mkUser("client");

// buyer1: a PENDING purchase we'll complete via the webhook.
const p1 = await mkPurchase(itemA, buyer1, pracA, { status: "pending" });

console.log("\n=== 1. Webhook: a signed checkout.session.completed flips the pending purchase to completed ===");
const fakePi = "pi_test_fake_" + stamp;
const event = {
  id: "evt_test_" + stamp, object: "event", type: "checkout.session.completed",
  data: { object: { id: "cs_test_" + stamp, object: "checkout.session", payment_status: "paid", payment_intent: fakePi, amount_total: 1500, metadata: { content_purchase_id: p1, commission_rate: "0.15", commission_cents: "225" } } },
};
const payload = JSON.stringify(event);
const sig = stripe.webhooks.generateTestHeaderString({ payload, secret: process.env.STRIPE_WEBHOOK_SECRET });
const whRes = await fetch(`${BASE}/api/webhooks/stripe`, { method: "POST", headers: { "stripe-signature": sig, "content-type": "application/json" }, body: payload });
check("webhook returns 2xx", whRes.ok, whRes.status);
await sleep(400);
const p1row = (await db.from("content_purchases").select("status, purchased_at, release_at, stripe_payment_intent_id").eq("id", p1).single()).data;
check("purchase is now completed", p1row?.status === "completed");
check("purchased_at is set", !!p1row?.purchased_at);
check("release_at is ~24h out (CONTENT_PAYOUT_HOLD_HOURS)", p1row?.release_at && new Date(p1row.release_at).getTime() > Date.now() + 22 * 3600e3);
check("payment_intent recorded from the event", p1row?.stripe_payment_intent_id === fakePi);

console.log("\n=== 2. Payout sweep content pass: due / not-due / frozen ===");
// p1: make it DUE (release_at in the past) — fake PI ⇒ transfer attempt FAILS ⇒ alert.
await db.from("content_purchases").update({ release_at: new Date(Date.now() - 3600e3).toISOString() }).eq("id", p1);
// p2: completed, NOT yet due (release_at future).
const p2 = await mkPurchase(itemA, buyer2, pracA, { status: "completed", releaseAt: new Date(Date.now() + 24 * 3600e3).toISOString(), pi: fakePi });
// p3: completed, due, but practitioner FROZEN ⇒ held.
const p3 = await mkPurchase(itemF, buyer3, pracF, { status: "completed", releaseAt: new Date(Date.now() - 3600e3).toISOString(), pi: fakePi });

const summary = await (await fetch(`${BASE}/api/admin/run-payout-sweep`, { headers: { Authorization: `Bearer ${process.env.CRON_SECRET}` } })).json();
console.log("  sweep summary:", JSON.stringify(summary));
await sleep(400);

const p1after = (await db.from("content_purchases").select("transfer_status").eq("id", p1).single()).data;
const p2after = (await db.from("content_purchases").select("transfer_status").eq("id", p2).single()).data;
const p3after = (await db.from("content_purchases").select("transfer_status").eq("id", p3).single()).data;
const alert1 = (await db.from("alerts").select("id").eq("type", "transfer_failed").eq("subject", p1).maybeSingle()).data;

check("DUE + fake PI: transfer attempted and FAILED → transfer_failed alert raised for the purchase", !!alert1);
check("DUE + failed: transfer_status stays 'pending' for retry (not falsely released)", p1after?.transfer_status === "pending");
check("NOT-yet-due: left 'pending', untouched", p2after?.transfer_status === "pending");
check("FROZEN practitioner + due: marked 'held'", p3after?.transfer_status === "held");

console.log("\n=== Cleanup ===");
await db.from("content_purchases").delete().in("id", [p1, p2, p3]);
await db.from("content_items").delete().in("id", [itemA, itemF]);
await db.from("alerts").delete().eq("subject", p1);
for (const id of created) await db.auth.admin.deleteUser(id).catch(() => {});

console.log(`\n=== RESULT: ${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`} ===`);
process.exit(failures === 0 ? 0 : 1);
