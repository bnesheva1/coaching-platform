// is_practitioner_onboarded (migration 20260906150000) — verification.
//   - the boolean function exists and matches the 4 onboarding sub-flags of
//     practitioner_bookable_flags (profile_complete AND has_active_service AND
//     availability_set AND connect_ready)
//   - a profile with no specialty (the pending-suggestions case) is NOT onboarded
//   - onboarded is orthogonal to moderation/subscription (>= is_practitioner_bookable)
//
// Requires migration 20260906150000 applied.
// Run: node --env-file=.env.local scripts/verify-onboarded-gate.mjs
import { createClient } from "@supabase/supabase-js";

const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SECRET_KEY);
const PW = "twelvecharspw1";
const stamp = Date.now();
const created = [];
let failures = 0;
const check = (l, c, d) => { if (!c) failures++; console.log(`${c ? "PASS" : "FAIL"} — ${l}${d !== undefined ? `  (${d})` : ""}`); };
const rpc = (fn, id) => db.rpc(fn, { target_practitioner_id: id }).then((r) => r.data);

async function main() {
  // 1. Function exists + cross-checks against the sub-flags for every profile.
  //    (service_role retains execute on practitioner_bookable_flags — the revoke
  //    was from public/anon/authenticated only — so we can read the sub-flags here.)
  const { data: rows } = await db.from("practitioner_profiles").select("id, username").limit(200);
  let mismatch = 0, onboardedCount = 0, bookableTrueButNotOnboarded = 0;
  for (const p of rows) {
    const [{ data: flags }, onboarded, bookable] = await Promise.all([
      db.rpc("practitioner_bookable_flags", { target_practitioner_id: p.id }).single(),
      rpc("is_practitioner_onboarded", p.id),
      rpc("is_practitioner_bookable", p.id),
    ]);
    const expected = !!(flags && flags.profile_complete && flags.has_active_service && flags.availability_set && flags.connect_ready);
    if (onboarded !== expected) { mismatch++; console.log(`   mismatch @${p.username}: onboarded=${onboarded} expected=${expected} flags=${JSON.stringify(flags)}`); }
    if (onboarded) onboardedCount++;
    // bookable == onboarded AND not_moderated AND subscription_ok, so bookable => onboarded.
    if (bookable && !onboarded) bookableTrueButNotOnboarded++;
  }
  check(`is_practitioner_onboarded matches the 4 sub-flags across ${rows.length} profiles`, mismatch === 0, `${mismatch} mismatched`);
  check("every bookable profile is also onboarded (onboarded is the superset)", bookableTrueButNotOnboarded === 0, `${bookableTrueButNotOnboarded} violations`);
  console.log(`   onboarded profiles: ${onboardedCount}/${rows.length}`);

  // 2. A fresh practitioner with no specialty/service (the pending-suggestions
  //    shape) must read as NOT onboarded.
  const { data: u, error: uErr } = await db.auth.admin.createUser({
    email: `onb-${stamp}@example.com`, password: PW, email_confirm: true,
    user_metadata: { role: "practitioner", display_name: "Onboard Test" },
  });
  if (uErr) { check("create test practitioner", false, uErr.message); return; }
  created.push(u.user.id);
  // simulate the pending-suggestions state: a pending suggestion, no real specialty/domain
  await db.from("practitioner_profiles")
    .update({ pending_specialty_suggestion: "family therapist", pending_domain_suggestion: "wellbeing" })
    .eq("id", u.user.id);
  const onboardedFresh = await rpc("is_practitioner_onboarded", u.user.id);
  check("profile with only pending suggestions (no specialty) is NOT onboarded", onboardedFresh === false, `onboarded=${onboardedFresh}`);
}

main()
  .catch((e) => { console.error(e); failures++; })
  .finally(async () => {
    for (const uid of created) await db.auth.admin.deleteUser(uid).catch(() => {});
    console.log(`\n${failures === 0 ? "ALL PASS" : failures + " FAILURE(S)"}`);
    process.exit(failures === 0 ? 0 : 1);
  });
