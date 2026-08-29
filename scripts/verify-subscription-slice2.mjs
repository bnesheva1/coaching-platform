// Subscription billing — slice 2 (enforcement) verification.
//
// Sets up a FULLY bookable software_provider practitioner (complete profile,
// active service, availability, no Connect needed), then drives
// subscription_status through every value and asserts the single derivation:
//   not_required / active / grace / exempt → bookable + findable   (lapse-only)
//   lapsed                                 → NOT bookable + NOT findable
// Also checks the saved-card path (get_practitioner_cards.bookable) and that a
// lapsed practitioner's row still exists (profile-by-URL is never gated).
//
// Requires migrations 20260829140000 + 20260829150000 applied. Run:
//   node --env-file=.env.local scripts/verify-subscription-slice2.mjs
import { createClient } from "@supabase/supabase-js";

const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SECRET_KEY);
const PW = "twelvecharspw1";
const stamp = Date.now();
const created = [];
let failures = 0;
const check = (label, cond, detail) => {
  if (!cond) failures++;
  console.log(`${cond ? "PASS" : "FAIL"} — ${label}${detail !== undefined ? `  (${detail})` : ""}`);
};

async function mkBookablePractitioner(tag) {
  const email = `sub2-${tag}-${stamp}@example.com`;
  const { data, error } = await db.auth.admin.createUser({
    email,
    password: PW,
    email_confirm: true,
    user_metadata: { role: "practitioner", display_name: `Sub2 ${tag} ${stamp}` },
  });
  if (error) throw error;
  const id = data.user.id;
  created.push(id);
  for (let i = 0; i < 20; i++) {
    if ((await db.from("practitioner_profiles").select("id").eq("id", id).maybeSingle()).data) break;
    await new Promise((r) => setTimeout(r, 200));
  }
  // Complete profile + software_provider so connect_ready is satisfied without Stripe.
  const { error: pErr } = await db
    .from("practitioner_profiles")
    .update({
      username: `sub2${tag}${stamp}`,
      timezone: "Europe/Sofia",
      avatar_url: "https://example.com/a.png",
      bio: "bio",
      headline: "headline",
      location: "Sofia",
      specialties: ["coaching"],
      billing_model: "software_provider",
    })
    .eq("id", id);
  if (pErr) throw pErr;
  const { error: sErr } = await db
    .from("services")
    .insert({ practitioner_id: id, name: "Session", duration_minutes: 60, price_cents: 5000, delivery_type: "online", is_active: true });
  if (sErr) throw sErr;
  const { error: aErr } = await db
    .from("practitioner_availability")
    .insert({ practitioner_id: id, day_of_week: 1, start_time: "09:00", end_time: "17:00" });
  if (aErr) throw aErr;
  return id;
}

const flags = async (id) => ({
  bookable: (await db.rpc("is_practitioner_bookable", { target_practitioner_id: id })).data,
  searchable: (await db.rpc("is_practitioner_searchable", { target_practitioner_id: id })).data,
});

async function cardBookable(id) {
  const { data } = await db.rpc("get_practitioner_cards", { practitioner_ids: [id] });
  return data?.[0]?.bookable;
}

async function inSearch(id) {
  // only_bookable=false so ONLY the searchable filter governs presence.
  const { data } = await db.rpc("search_practitioners", { specialty_keys: null, search_query: null, only_bookable: false });
  return (data ?? []).some((r) => r.id === id);
}

async function main() {
  console.log("=== Setup: a fully bookable practitioner ===");
  const id = await mkBookablePractitioner("a");

  // Baseline sanity — with not_required they must be fully bookable, else the
  // rest of the test is meaningless (setup, not the feature, would be at fault).
  const base = await flags(id);
  check("baseline bookable (not_required)", base.bookable === true, base.bookable);
  check("baseline searchable (not_required)", base.searchable === true, base.searchable);

  const cases = [
    { status: "not_required", bookable: true },
    { status: "active", bookable: true },
    { status: "grace", bookable: true },
    { status: "exempt", bookable: true },
    { status: "lapsed", bookable: false },
  ];

  for (const c of cases) {
    console.log(`\n=== subscription_status = '${c.status}' (expect bookable=${c.bookable}) ===`);
    const { error } = await db.from("practitioner_profiles").update({ subscription_status: c.status }).eq("id", id);
    check(`set status '${c.status}'`, !error, error?.message);
    const f = await flags(id);
    check(`is_practitioner_bookable = ${c.bookable}`, f.bookable === c.bookable, f.bookable);
    check(`is_practitioner_searchable = ${c.bookable}`, f.searchable === c.bookable, f.searchable);
    check(`saved-card bookable = ${c.bookable}`, (await cardBookable(id)) === c.bookable);
    check(`present in search = ${c.bookable}`, (await inSearch(id)) === c.bookable);
  }

  // Profile-by-URL is never gated: even lapsed, the row is intact + selectable.
  console.log("\n=== Profile intact while lapsed ===");
  await db.from("practitioner_profiles").update({ subscription_status: "lapsed" }).eq("id", id);
  const { data: row } = await db.from("practitioner_profiles").select("id, username").eq("id", id).maybeSingle();
  check("lapsed practitioner row still exists (profile-by-URL unaffected)", !!row?.username);

  console.log("\n=== Cleanup ===");
  for (const uid of created) {
    await db.from("services").delete().eq("practitioner_id", uid);
    await db.from("practitioner_availability").delete().eq("practitioner_id", uid);
    await db.auth.admin.deleteUser(uid).catch(() => {});
  }
  console.log(`\n${failures === 0 ? "ALL PASSED" : `${failures} FAILURE(S)`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
