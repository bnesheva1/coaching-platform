// Slice 4 (admin kill switches + numbers). Verifies against the LIVE schema
// that every new query the /admin page + cost breaker run actually resolves —
// the biggest risk in this slice is a wrong column/table name (commission_cents,
// delivery_type, status, is_active…). Also round-trips a feature_flags override
// (the toggle action's DB effect) and the breaker's video=false write, cleaning
// up after itself.
//
// Run: node --env-file=.env.local scripts/verify-admin-switches-numbers.mjs

import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SECRET_KEY;
const db = createClient(url, serviceKey);

let failures = 0;
function check(label, condition, detail) {
  console.log(`${condition ? "PASS" : "FAIL"} — ${label}${detail !== undefined ? `  (${detail})` : ""}`);
  if (!condition) failures++;
}

const now = new Date();
const nowIso = now.toISOString();
const weekEnd = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString();
const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();

console.log("=== Numbers queries (schema correctness) ===");

const upcoming = await db.from("bookings").select("id", { count: "exact", head: true }).neq("status", "cancelled").gte("start_utc", nowIso);
check("bookings upcoming count", !upcoming.error, upcoming.error?.message ?? `count=${upcoming.count}`);

const week = await db.from("bookings").select("id", { count: "exact", head: true }).neq("status", "cancelled").gte("start_utc", nowIso).lt("start_utc", weekEnd);
check("bookings this-week count", !week.error, week.error?.message ?? `count=${week.count}`);

const total = await db.from("bookings").select("id", { count: "exact", head: true });
check("bookings total count", !total.error, total.error?.message ?? `count=${total.count}`);

const pracs = await db.from("profiles").select("id", { count: "exact", head: true }).eq("role", "practitioner");
check("practitioners registered count", !pracs.error, pracs.error?.message ?? `count=${pracs.count}`);

const clients = await db.from("profiles").select("id", { count: "exact", head: true }).eq("role", "client");
check("clients registered count", !clients.error, clients.error?.message ?? `count=${clients.count}`);

const activeServices = await db.from("services").select("practitioner_id").eq("is_active", true);
check("active services -> bookable set", !activeServices.error, activeServices.error?.message ?? `rows=${(activeServices.data ?? []).length}, distinct=${new Set((activeServices.data ?? []).map((r) => r.practitioner_id)).size}`);

const payments = await db.from("payments").select("amount_cents, commission_cents").eq("status", "succeeded").gte("created_at", monthStart);
check("payments revenue (amount_cents + commission_cents)", !payments.error, payments.error?.message ?? `rows=${(payments.data ?? []).length}`);

console.log("\n=== Video usage projection query ===");
const online = await db.from("bookings").select("start_utc, end_utc, status").eq("delivery_type", "online").neq("status", "cancelled").gte("start_utc", monthStart);
check("online bookings this month (delivery_type/status)", !online.error, online.error?.message ?? `rows=${(online.data ?? []).length}`);

console.log("\n=== feature_flags round-trip (toggle action DB effect) ===");
const TEST_KEY = "newBookings";
// snapshot any existing override so we restore exactly
const before = await db.from("feature_flags").select("key, enabled, updated_by").eq("key", TEST_KEY).maybeSingle();
check("feature_flags read", !before.error, before.error?.message ?? `existing=${before.data ? before.data.enabled : "none"}`);

const up = await db.from("feature_flags").upsert({ key: TEST_KEY, enabled: false, updated_by: null, updated_at: new Date().toISOString() }, { onConflict: "key" });
check("feature_flags upsert (write override)", !up.error, up.error?.message);

const readBack = await db.from("feature_flags").select("enabled").eq("key", TEST_KEY).single();
check("override reads back as false", !readBack.error && readBack.data?.enabled === false, readBack.error?.message ?? `enabled=${readBack.data?.enabled}`);

console.log("\n=== breaker video=false write path ===");
const beforeVideo = await db.from("feature_flags").select("enabled").eq("key", "video").maybeSingle();
const vid = await db.from("feature_flags").upsert({ key: "video", enabled: false, updated_by: null, updated_at: new Date().toISOString() }, { onConflict: "key" });
check("breaker upsert video=false", !vid.error, vid.error?.message);

console.log("\n=== Cleanup (restore prior state) ===");
// restore/remove the newBookings override
if (before.data) {
  await db.from("feature_flags").update({ enabled: before.data.enabled, updated_by: before.data.updated_by }).eq("key", TEST_KEY);
  console.log(`restored ${TEST_KEY} -> ${before.data.enabled}`);
} else {
  await db.from("feature_flags").delete().eq("key", TEST_KEY);
  console.log(`removed test ${TEST_KEY} override`);
}
// restore/remove the video override
if (beforeVideo.data) {
  await db.from("feature_flags").update({ enabled: beforeVideo.data.enabled }).eq("key", "video");
  console.log(`restored video -> ${beforeVideo.data.enabled}`);
} else {
  await db.from("feature_flags").delete().eq("key", "video");
  console.log("removed test video override");
}

console.log(`\n${failures === 0 ? "ALL PASS" : `${failures} FAILURE(S)`}`);
process.exit(failures === 0 ? 0 : 1);
