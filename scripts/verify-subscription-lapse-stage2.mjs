// Subscription lapse — stage two (full hide) + renewal-shape verification.
//
// Change 2 (fully hidden = lapsed AND no outstanding booking):
//   - is_practitioner_fully_hidden across not_required / lapsed±bookings / active
//   - get_practitioner_cards.visible mirrors it (card stops linking)
//   - only pending/confirmed count as outstanding; completed/cancelled don't
// Change 1 (renewal never recreates): get_my_subscription_context.has_subscription
//   drives startSubscription → Billing Portal (revive) vs fresh checkout.
//
// Requires migrations through 20260829170000 applied. Run:
//   node --env-file=.env.local scripts/verify-subscription-lapse-stage2.mjs
import { createClient } from "@supabase/supabase-js";

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const db = createClient(URL, process.env.SUPABASE_SECRET_KEY);
const ANON = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const PW = "twelvecharspw1";
const stamp = Date.now();
const created = [];
let failures = 0;
const check = (l, c, d) => { if (!c) failures++; console.log(`${c ? "PASS" : "FAIL"} — ${l}${d !== undefined ? `  (${d})` : ""}`); };

async function mkUser(role, name) {
  const email = `laps2-${role}-${stamp}@example.com`;
  const { data, error } = await db.auth.admin.createUser({ email, password: PW, email_confirm: true, user_metadata: { role, display_name: name } });
  if (error) throw error;
  created.push(data.user.id);
  await new Promise((r) => setTimeout(r, 300));
  return { id: data.user.id, email };
}

const fullyHidden = async (id) => (await db.rpc("is_practitioner_fully_hidden", { target_practitioner_id: id })).data;
async function card(id) {
  const { data } = await db.rpc("get_practitioner_cards", { practitioner_ids: [id] });
  return data?.[0] ?? null;
}
async function setStatus(id, s) { await db.from("practitioner_profiles").update({ subscription_status: s }).eq("id", id); }
async function addBooking(pracId, clientId, serviceId, status, when) {
  const start = new Date(Date.now() + when).toISOString();
  const end = new Date(Date.now() + when + 3600e3).toISOString();
  const { data, error } = await db.from("bookings")
    .insert({ practitioner_id: pracId, client_id: clientId, service_id: serviceId, start_utc: start, end_utc: end, status, service_name: "S", price_cents: 5000, currency: "EUR", delivery_type: "online" })
    .select("id").single();
  if (error) throw error;
  return data.id;
}

async function main() {
  console.log("=== Setup ===");
  const prac = await mkUser("practitioner", `Laps2 Prac ${stamp}`);
  const client = await mkUser("client", `Laps2 Client ${stamp}`);
  for (let i = 0; i < 20; i++) { if ((await db.from("practitioner_profiles").select("id").eq("id", prac.id).maybeSingle()).data) break; await new Promise((r) => setTimeout(r, 200)); }
  await db.from("practitioner_profiles").update({ username: `laps2${stamp}`, timezone: "Europe/Sofia", billing_model: "software_provider" }).eq("id", prac.id);
  const service = (await db.from("services").insert({ practitioner_id: prac.id, name: "S", duration_minutes: 60, price_cents: 5000, currency: "EUR", is_active: true, delivery_type: "online" }).select("id").single()).data;

  console.log("\n=== not_required → visible ===");
  check("not fully hidden", (await fullyHidden(prac.id)) === false);
  check("card visible", (await card(prac.id))?.visible === true);

  console.log("\n=== lapsed, no bookings → fully hidden ===");
  await setStatus(prac.id, "lapsed");
  check("fully hidden = true", (await fullyHidden(prac.id)) === true);
  let c = await card(prac.id);
  check("card visible = false", c?.visible === false, c?.visible);
  check("card bookable = false", c?.bookable === false);

  console.log("\n=== lapsed + an outstanding (confirmed, future) booking → reachable ===");
  const bkOutstanding = await addBooking(prac.id, client.id, service.id, "confirmed", 48 * 3600e3);
  check("fully hidden = false while a session is outstanding", (await fullyHidden(prac.id)) === false);
  check("card visible = true", (await card(prac.id))?.visible === true);

  console.log("\n=== that booking completes → fully hidden again ===");
  await db.from("bookings").update({ status: "completed" }).eq("id", bkOutstanding);
  check("fully hidden = true once no session is outstanding", (await fullyHidden(prac.id)) === true);
  check("card visible = false", (await card(prac.id))?.visible === false);

  console.log("\n=== a cancelled booking doesn't count as outstanding ===");
  await addBooking(prac.id, client.id, service.id, "cancelled_by_client", 72 * 3600e3);
  check("still fully hidden (cancelled ≠ outstanding)", (await fullyHidden(prac.id)) === true);

  console.log("\n=== one payment → active restores visibility ===");
  await setStatus(prac.id, "active");
  check("fully hidden = false", (await fullyHidden(prac.id)) === false);
  check("card visible = true", (await card(prac.id))?.visible === true);

  console.log("\n=== Change 1: has_subscription drives revive-vs-fresh ===");
  const asUser = createClient(URL, ANON);
  await asUser.auth.signInWithPassword({ email: prac.email, password: PW });
  await db.from("practitioner_profiles").update({ stripe_subscription_id: "sub_test_x", subscription_status: "lapsed" }).eq("id", prac.id);
  let ctx = (await asUser.rpc("get_my_subscription_context").single()).data;
  check("has_subscription = true → startSubscription routes to Billing Portal (revive)", ctx?.has_subscription === true, ctx?.has_subscription);
  // Simulate the exempt-cancel clearing the id (what setSubscriptionOverride does on success).
  await db.from("practitioner_profiles").update({ stripe_subscription_id: null }).eq("id", prac.id);
  ctx = (await asUser.rpc("get_my_subscription_context").single()).data;
  check("id cleared → has_subscription = false → un-exempt needs a fresh subscribe", ctx?.has_subscription === false, ctx?.has_subscription);

  console.log("\n=== Cleanup ===");
  await db.from("bookings").delete().eq("practitioner_id", prac.id);
  await db.from("services").delete().eq("practitioner_id", prac.id);
  for (const id of created) await db.auth.admin.deleteUser(id).catch(() => {});
  console.log(`\n${failures === 0 ? "ALL PASSED" : `${failures} FAILURE(S)`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
