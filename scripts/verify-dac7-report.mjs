// DAC7 quarterly aggregation — verified against real seeded data. Drives the
// admin export endpoint (CRON_SECRET) after seeding released/refunded/pending
// payments + a content sale across quarters, with one practitioner missing a TIN.
//
// Requires: dev server running; migration 20260918130000_transferred_at applied.
// Run: node --env-file=.env.local scripts/verify-dac7-report.mjs

import { createClient } from "@supabase/supabase-js";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SECRET_KEY, { auth: { persistSession: false } });
const YEAR = 2026;
const stamp = Date.now();
let failures = 0;
const check = (l, c, d) => { if (!c) failures++; console.log(`${c ? "PASS" : "FAIL"} — ${l}${d !== undefined ? `  (${d})` : ""}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const created = [];

async function mkUser(role) {
  const email = `dac7-${role}-${stamp}-${Math.random().toString(36).slice(2, 6)}@example.com`;
  const { data, error } = await db.auth.admin.createUser({ email, password: "twelvecharspw1", email_confirm: true, user_metadata: { role, display_name: `DAC7 ${role} ${stamp}` } });
  if (error) throw error;
  created.push(data.user.id);
  if (role === "practitioner") for (let i = 0; i < 25; i++) { if ((await db.from("practitioner_profiles").select("id").eq("id", data.user.id).maybeSingle()).data) break; await sleep(200); }
  return data.user.id;
}
async function mkPractitioner(tin) {
  const id = await mkUser("practitioner");
  await db.from("practitioner_profiles").update({ billing_model: "commission", stripe_connected_account_id: "acct_" + id.slice(0, 8), ...(tin ? { tin, tin_type: "egn" } : {}) }).eq("id", id);
  return id;
}
async function mkService(pracId) {
  const { data } = await db.from("services").insert({ practitioner_id: pracId, name: "DAC7 Svc", duration_minutes: 30, price_cents: 5000, currency: "EUR", is_active: true, delivery_type: "online", delivery_info: "x" }).select("id").single();
  return data.id;
}
// A completed booking + its payments row, credited (transferred) on `transferredAt`.
async function mkPayment(pracId, buyerId, serviceId, { amount, commission, status, transferStatus, transferredAt }) {
  const start = "2026-01-02T10:00:00.000Z";
  const { data: b } = await db.from("bookings").insert({ practitioner_id: pracId, client_id: buyerId, service_id: serviceId, start_utc: start, end_utc: "2026-01-02T10:30:00.000Z", status: "completed", delivery_type: "online", service_name: "DAC7 Svc", price_cents: amount, currency: "EUR" }).select("id").single();
  await db.from("payments").insert({ booking_id: b.id, stripe_checkout_session_id: "cs_" + Math.random().toString(36).slice(2), amount_cents: amount, commission_cents: commission, currency: "EUR", status, transfer_status: transferStatus, transferred_at: transferredAt });
  return b.id;
}
async function mkContentSale(pracId, buyerId, { amount, commission, transferStatus, transferredAt }) {
  const { data: item } = await db.from("content_items").insert({ practitioner_id: pracId, type: "video_youtube", title: "DAC7 vid", price_cents: amount, currency: "EUR", youtube_video_id: "dQw4w9WgXcQ" }).select("id").single();
  await db.from("content_purchases").insert({ content_item_id: item.id, buyer_id: buyerId, practitioner_id: pracId, status: "completed", amount_cents: amount, currency: "EUR", commission_cents: commission, transfer_status: transferStatus, transferred_at: transferredAt });
  return item.id;
}

console.log("=== Setup ===");
const VALID_EGN = "7523169263";
const pracWithTin = await mkPractitioner(VALID_EGN);
const pracNoTin = await mkPractitioner(null);
const buyer = await mkUser("client");
const svc1 = await mkService(pracWithTin);
const svc2 = await mkService(pracNoTin);

// pracWithTin: Q2 booking (released), Q3 content sale (released), a REFUNDED
// booking (excluded), a PENDING payout (excluded).
await mkPayment(pracWithTin, buyer, svc1, { amount: 10000, commission: 1500, status: "succeeded", transferStatus: "released", transferredAt: "2026-05-15T12:00:00.000Z" });
await mkContentSale(pracWithTin, buyer, { amount: 2000, commission: 300, transferStatus: "released", transferredAt: "2026-08-10T12:00:00.000Z" });
await mkPayment(pracWithTin, buyer, svc1, { amount: 9999, commission: 1000, status: "refunded", transferStatus: "reversed", transferredAt: "2026-05-16T12:00:00.000Z" });
await mkPayment(pracWithTin, buyer, svc1, { amount: 7777, commission: 1000, status: "succeeded", transferStatus: "pending", transferredAt: null });
// pracNoTin: Q1 booking (released).
await mkPayment(pracNoTin, buyer, svc2, { amount: 5000, commission: 750, status: "succeeded", transferStatus: "released", transferredAt: "2026-02-10T12:00:00.000Z" });

console.log("\n=== Report ===");
const res = await fetch(`${BASE}/api/admin/dac7-report?year=${YEAR}`, { headers: { Authorization: `Bearer ${process.env.CRON_SECRET}` } });
check("endpoint returns 200", res.ok, res.status);
const report = await res.json();
const rowsFor = (pracId, q) => (report.rows ?? []).find((r) => r.practitionerId === pracId && r.quarter === q);

const q2 = rowsFor(pracWithTin, 2);
check("pracWithTin Q2 consideration = 10000 (gross; refund/pending excluded)", q2?.considerationCents === 10000, q2?.considerationCents);
check("pracWithTin Q2 commission = 1500", q2?.commissionCents === 1500);
check("pracWithTin Q2 net = 8500", q2?.netCents === 8500);
check("pracWithTin Q2 activities = 1", q2?.activities === 1);
check("pracWithTin Q2 TIN present, not flagged missing", q2?.tin === VALID_EGN && q2?.tinMissing === false);

const q3 = rowsFor(pracWithTin, 3);
check("pracWithTin Q3 content sale bucketed by transfer date: consideration 2000", q3?.considerationCents === 2000, q3?.considerationCents);
check("pracWithTin Q3 activities = 1 (content sale counted)", q3?.activities === 1);

const q1 = rowsFor(pracNoTin, 1);
check("pracNoTin Q1 consideration = 5000", q1?.considerationCents === 5000);
check("pracNoTin Q1 flagged TIN missing", q1?.tinMissing === true);
check("pracNoTin appears in practitionersMissingTin", (report.practitionersMissingTin ?? []).some((p) => p.practitionerId === pracNoTin));
check("pracWithTin NOT in practitionersMissingTin", !(report.practitionersMissingTin ?? []).some((p) => p.practitionerId === pracWithTin));

// Refund/pending must not have inflated any total for pracWithTin.
const withTinTotal = (report.rows ?? []).filter((r) => r.practitionerId === pracWithTin).reduce((s, r) => s + r.considerationCents, 0);
check("pracWithTin total across quarters = 12000 (10000 + 2000 only)", withTinTotal === 12000, withTinTotal);

console.log("\n=== Cleanup ===");
await db.from("content_purchases").delete().eq("buyer_id", buyer);
await db.from("payments").delete().in("booking_id", (await db.from("bookings").select("id").in("practitioner_id", [pracWithTin, pracNoTin])).data?.map((b) => b.id) ?? []);
await db.from("bookings").delete().in("practitioner_id", [pracWithTin, pracNoTin]);
await db.from("content_items").delete().in("practitioner_id", [pracWithTin, pracNoTin]);
for (const id of created) await db.auth.admin.deleteUser(id).catch(() => {});

console.log(`\n=== RESULT: ${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`} ===`);
process.exit(failures === 0 ? 0 : 1);
