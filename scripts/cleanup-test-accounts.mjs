// Clean up throwaway TEST/SEED accounts left behind by the verify-*.mjs scripts.
//
// Test accounts are identified SOLELY by their email domain: every verify
// script seeds users with `@example.com` addresses (a reserved, non-deliverable
// domain per RFC 2606 — no real signup can confirm one). Real accounts deleted
// through the app are anonymised to `deleted-<id>@deleted.invalid` (a DIFFERENT
// domain) and are deliberately NOT matched here.
//
// DRY-RUN by default: prints the matched-account count and, per referencing
// table, how many rows are tied to those accounts and what a hard delete would
// do to them (CASCADE / SET NULL / RESTRICT-blocks). Pass --apply to actually
// delete. --apply first clears the RESTRICT references (admin actor columns,
// bulk_cancellations, bookings.immediate_request_id) so the cascade can proceed,
// then hard-deletes the auth.users rows (auth.users → profiles → everything
// cascades from there).
//
// Run (dry-run):  node --env-file=.env.local scripts/cleanup-test-accounts.mjs
// Run (execute):  node --env-file=.env.local scripts/cleanup-test-accounts.mjs --apply

import { createClient } from "@supabase/supabase-js";

const APPLY = process.argv.includes("--apply");
const TEST_EMAIL_SUFFIX = "@example.com";
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SECRET_KEY, {
  auth: { persistSession: false },
});

const chunk = (arr, n) => Array.from({ length: Math.ceil(arr.length / n) }, (_, i) => arr.slice(i * n, i * n + n));

// count rows where `column` ∈ ids (chunked to keep URLs short)
async function countIn(table, column, ids) {
  if (!ids.length) return 0;
  let total = 0;
  for (const part of chunk(ids, 100)) {
    const { count, error } = await db.from(table).select("*", { count: "exact", head: true }).in(column, part);
    if (error) return `ERR(${error.code ?? "?"}): ${error.message || "not API-exposed?"}`;
    total += count ?? 0;
  }
  return total;
}
// collect distinct ids from `select` where any of `columns` ∈ ids
async function idsWhereIn(table, columns, ids, selectCol = "id") {
  if (!ids.length) return [];
  const found = new Set();
  for (const col of columns) {
    for (const part of chunk(ids, 100)) {
      const { data, error } = await db.from(table).select(selectCol).in(col, part);
      if (error) throw new Error(`${table}.${col}: ${error.message}`);
      for (const r of data) found.add(r[selectCol]);
    }
  }
  return [...found];
}

async function listTestUsers() {
  const test = [];
  let page = 1;
  for (;;) {
    const { data, error } = await db.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw error;
    for (const u of data.users) {
      if ((u.email ?? "").toLowerCase().endsWith(TEST_EMAIL_SUFFIX)) test.push({ id: u.id, email: u.email });
    }
    if (data.users.length < 1000) break;
    page++;
  }
  return test;
}

(async () => {
  console.log(`\n=== Test-account cleanup — ${APPLY ? "APPLY (DESTRUCTIVE)" : "DRY-RUN (no writes)"} ===`);
  console.log(`Criterion: auth.users.email ILIKE '%${TEST_EMAIL_SUFFIX}'\n`);

  const testUsers = await listTestUsers();
  const ids = testUsers.map((u) => u.id);
  console.log(`Matched test accounts: ${testUsers.length}`);
  if (testUsers.length) {
    console.log("Sample (up to 8):");
    for (const u of testUsers.slice(0, 8)) console.log(`  ${u.id}  ${u.email}`);
  }
  if (!ids.length) { console.log("\nNothing to do."); process.exit(0); }

  // derive the practitioner subset and the set of bookings tied to test users
  const testPractitionerIds = await idsWhereIn("practitioner_profiles", ["id"], ids, "id");
  const testBookingIds = await idsWhereIn("bookings", ["client_id", "practitioner_id"], ids, "id");
  console.log(`\nOf those, practitioner profiles: ${testPractitionerIds.length}`);
  console.log(`Bookings tied to test users (as client or practitioner): ${testBookingIds.length}`);

  // ---- CASCADE group: auto-removed when the auth.users row is hard-deleted ----
  const cascade = [
    ["profiles", "id", ids],
    ["practitioner_profiles", "id", ids],
    ["services", "practitioner_id", ids],
    ["practitioner_availability", "practitioner_id", ids],
    ["availability_exceptions", "practitioner_id", ids],
    ["practitioner_search_documents", "practitioner_id", ids],
    ["practitioner_view_counters", "practitioner_id", ids],
    ["practitioner_gallery", "practitioner_id", ids],
    ["practitioner_videos", "practitioner_id", ids],
    ["username_history", "practitioner_id", ids],
    ["rename_events", "user_id", ids],
    ["saved_practitioners (client)", "client_id", ids, "saved_practitioners"],
    ["saved_practitioners (practitioner)", "practitioner_id", ids, "saved_practitioners"],
    ["admin_login_events", "admin_id", ids],
    ["immediate_presence", "practitioner_id", ids],
    ["immediate_requests (client)", "client_id", ids, "immediate_requests"],
    ["immediate_requests (practitioner)", "practitioner_id", ids, "immediate_requests"],
    ["immediate_holds", "practitioner_id", ids],
    ["bookings (client)", "client_id", ids, "bookings"],
    ["bookings (practitioner)", "practitioner_id", ids, "bookings"],
    ["reviews (practitioner)", "practitioner_id", ids, "reviews"],
    ["video_fallback_reveals (revealed_to)", "revealed_to", ids, "video_fallback_reveals"],
    // via bookings:
    ["payments", "booking_id", testBookingIds],
    ["reviews (via booking)", "booking_id", testBookingIds, "reviews"],
    ["session_documents", "booking_id", testBookingIds],
    ["session_document_events", "booking_id", testBookingIds],
    ["video_sessions", "booking_id", testBookingIds],
    ["video_attendance_events", "booking_id", testBookingIds],
    ["video_fallback_reveals (via booking)", "booking_id", testBookingIds, "video_fallback_reveals"],
  ];
  // ---- SET NULL group: row survives, column nulled ----
  const setNull = [["video_attendance_events", "participant_id", ids]];
  // ---- RESTRICT group: NO-ACTION FK — BLOCKS the delete until cleared ----
  const restrict = [
    ["admin_audit_log", "actor_id", ids],
    ["alerts", "dismissed_by", ids],
    ["feature_flags", "updated_by", ids],
    ["bulk_cancellations (practitioner)", "practitioner_id", ids, "bulk_cancellations"],
    ["bulk_cancellations (initiated_by)", "initiated_by", ids, "bulk_cancellations"],
    ["practitioner_profiles.moderation_applied_by", "moderation_applied_by", ids, "practitioner_profiles"],
    ["practitioner_profiles.payouts_frozen_by", "payouts_frozen_by", ids, "practitioner_profiles"],
    ["practitioner_profiles.commission_rate_set_by", "commission_rate_set_by", ids, "practitioner_profiles"],
    ["practitioner_profiles.subscription_override_set_by", "subscription_override_set_by", ids, "practitioner_profiles"],
    ["bookings.immediate_request_id (blocks req delete)", "immediate_request_id", await idsWhereIn("immediate_requests", ["client_id", "practitioner_id"], ids, "id"), "bookings"],
  ];

  async function report(title, rows) {
    console.log(`\n--- ${title} ---`);
    let sum = 0;
    for (const [label, col, idset, table] of rows) {
      const c = await countIn(table ?? label, col, idset);
      if (typeof c === "number") sum += c;
      console.log(`  ${String(c).padStart(6)}  ${label}${typeof c !== "number" ? "" : ` (${col})`}`);
    }
    return sum;
  }

  await report("CASCADE — auto-deleted with the user", cascade);
  await report("SET NULL — row kept, column nulled", setNull);
  const blockers = await report("RESTRICT (NO ACTION) — BLOCKS delete until cleared", restrict);

  if (!APPLY) {
    console.log(`\n=== DRY-RUN complete — no rows changed. ===`);
    console.log(`Re-run with --apply to execute (will clear ${blockers} blocking reference(s), then hard-delete ${ids.length} users).`);
    process.exit(0);
  }

  // ---- APPLY ----
  console.log(`\n=== APPLYING — clearing blockers, then hard-deleting ${ids.length} users ===`);
  // 1) null the NO-ACTION actor columns pointing at test ids (on any surviving row)
  for (const [tbl, cols] of [
    ["admin_audit_log", ["actor_id"]],
    ["alerts", ["dismissed_by"]],
    ["feature_flags", ["updated_by"]],
    ["practitioner_profiles", ["moderation_applied_by", "payouts_frozen_by", "commission_rate_set_by", "subscription_override_set_by"]],
  ]) {
    for (const col of cols) for (const part of chunk(ids, 100)) {
      const { error } = await db.from(tbl).update({ [col]: null }).in(col, part);
      if (error) console.error(`  clear ${tbl}.${col}: ${error.message}`);
    }
  }
  // 2) delete rows whose NOT-NULL FK can't be nulled
  const reqIds = await idsWhereIn("immediate_requests", ["client_id", "practitioner_id"], ids, "id");
  for (const part of chunk(reqIds, 100)) await db.from("bookings").update({ immediate_request_id: null }).in("immediate_request_id", part);
  for (const part of chunk(ids, 100)) {
    await db.from("bulk_cancellations").delete().in("practitioner_id", part);
    await db.from("bulk_cancellations").delete().in("initiated_by", part);
  }
  // 2b) The services search-sync trigger calls refresh_practitioner_search_document,
  // which re-inserts a search-doc row. During a cascade delete of a practitioner
  // that insert references the practitioner_profiles row being removed → FK
  // violation (surfacing as a GoTrue 500). The guard that made this a no-op
  // (migration 20260709120000) was later dropped by 20260726131800, so the bug
  // is live again. Delete services up front — while the practitioner still
  // exists, so the trigger's re-insert is valid — so the auth-delete cascade no
  // longer fires it; the practitioner_profiles delete trigger then removes the
  // now-stale search doc.
  for (const part of chunk(testPractitionerIds, 100)) {
    const { error } = await db.from("services").delete().in("practitioner_id", part);
    if (error) console.error(`  clear services: ${error.message}`);
  }

  // 3) hard-delete the auth users — cascade removes everything downstream
  let deleted = 0, failed = 0;
  for (const u of testUsers) {
    const { error } = await db.auth.admin.deleteUser(u.id, false); // false = HARD delete
    if (error) { failed++; console.error(`  delete ${u.email}: ${error.message || error.name} [status=${error.status} code=${error.code}]`); } else deleted++;
  }
  console.log(`\n=== Done. Hard-deleted ${deleted} users, ${failed} failed. ===`);
})().catch((e) => { console.error("FATAL:", e); process.exit(1); });
