// Manual admin-review gate — end-to-end verification against the live DB.
// Requires migration 20260911120000 applied.
// Run: node --env-file=.env.local scripts/verify-review-gate.mjs
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const db = createClient(url, process.env.SUPABASE_SECRET_KEY, { auth: { persistSession: false } });
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const PW = "twelvecharspw1";
const stamp = Date.now();
let failures = 0;
const created = [];
const check = (l, c, d) => { if (!c) failures++; console.log(`${c ? "PASS" : "FAIL"} — ${l}${d !== undefined ? `  (${d})` : ""}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function userClient(email) {
  const c = createClient(url, anonKey, { auth: { persistSession: false } });
  const { error } = await c.auth.signInWithPassword({ email, password: PW });
  if (error) throw new Error("signIn failed: " + error.message);
  return c;
}
const flags = async (id) => ({
  searchable: (await db.rpc("is_practitioner_searchable", { target_practitioner_id: id })).data,
  bookable: (await db.rpc("is_practitioner_bookable", { target_practitioner_id: id })).data,
});
const modRow = async (id) => (await db.from("practitioner_profiles").select("moderation_status, review_submitted_at, moderation_reason").eq("id", id).single()).data;
const setStatus = (id, status, reason = null) => db.from("practitioner_profiles").update({ moderation_status: status, moderation_reason: reason }).eq("id", id);

(async () => {
  console.log("=== Review-gate verification ===\n");
  const email = `reviewgate-practitioner-${stamp}@example.com`;
  const { data: mk, error: mkErr } = await db.auth.admin.createUser({
    email, password: PW, email_confirm: true, user_metadata: { role: "practitioner", display_name: `Review Test ${stamp}` },
  });
  if (mkErr) throw mkErr;
  const id = mk.user.id;
  created.push(id);
  // wait for the signup trigger to create the practitioner_profiles row
  for (let i = 0; i < 25; i++) { if (await modRow(id)) break; await sleep(200); }

  // 1. New profile defaults to pending + not submitted
  let row = await modRow(id);
  check("new profile defaults to moderation_status='pending'", row?.moderation_status === "pending", row?.moderation_status);
  check("new profile review_submitted_at is null (draft, not in queue)", row?.review_submitted_at === null, row?.review_submitted_at);

  // 2. pending is excluded from search + booking
  let f = await flags(id);
  check("pending → is_practitioner_searchable false", f.searchable === false, f.searchable);
  check("pending → is_practitioner_bookable false", f.bookable === false, f.bookable);

  // 3. Owner submit-for-review: pending(draft) → pending + submitted stamp
  const uc = await userClient(email);
  const gms1 = (await uc.rpc("get_my_moderation_status").single()).data;
  check("get_my_moderation_status returns review_submitted_at field", gms1 && "review_submitted_at" in gms1, JSON.stringify(gms1));
  const { error: subErr } = await uc.rpc("submit_practitioner_for_review");
  check("submit_practitioner_for_review succeeds for owner", !subErr, subErr?.message);
  row = await modRow(id);
  check("after submit: still pending", row?.moderation_status === "pending", row?.moderation_status);
  check("after submit: review_submitted_at is set (now in queue)", !!row?.review_submitted_at, row?.review_submitted_at);
  f = await flags(id);
  check("submitted-pending still not searchable/bookable", f.searchable === false && f.bookable === false, `${f.searchable}/${f.bookable}`);

  // 4. changes_requested is excluded + carries reason; owner can resubmit
  await setStatus(id, "changes_requested", "Моля, допълни биографията си.");
  f = await flags(id);
  check("changes_requested → not searchable/bookable", f.searchable === false && f.bookable === false, `${f.searchable}/${f.bookable}`);
  const gms2 = (await uc.rpc("get_my_moderation_status").single()).data;
  check("owner sees changes_requested + reason", gms2?.moderation_status === "changes_requested" && !!gms2?.moderation_reason, JSON.stringify(gms2));
  await uc.rpc("submit_practitioner_for_review");
  row = await modRow(id);
  check("resubmit: changes_requested → pending", row?.moderation_status === "pending", row?.moderation_status);
  check("resubmit: reason cleared", row?.moderation_reason === null, row?.moderation_reason);
  check("resubmit: review_submitted_at set", !!row?.review_submitted_at, row?.review_submitted_at);

  // 5. Guard: cannot self-escape a real moderation control
  await setStatus(id, "suspended", "abuse");
  await uc.rpc("submit_practitioner_for_review");
  row = await modRow(id);
  check("submit_for_review canNOT move suspended → pending (guard holds)", row?.moderation_status === "suspended", row?.moderation_status);

  // 6. Approved (active) is searchable again
  await setStatus(id, "active");
  f = await flags(id);
  check("active → is_practitioner_searchable true", f.searchable === true, f.searchable);

  // cleanup
  for (const uid of created) { await db.from("services").delete().eq("practitioner_id", uid); await db.auth.admin.deleteUser(uid, false).catch(() => {}); }

  console.log(`\n=== ${failures === 0 ? "ALL PASSED" : failures + " FAILED"} ===`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => { console.error("FATAL:", e); process.exit(1); });
