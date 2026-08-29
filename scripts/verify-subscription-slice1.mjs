// Subscription billing — slice 1 (dormant machinery) verification.
//
// What this proves WITHOUT touching Stripe (the hosted Checkout / dunning flow
// is exercised manually in test mode — see the notes at the bottom):
//   1. The new columns exist with the right defaults on a fresh practitioner.
//   2. get_my_subscription_context() returns the CALLER's own row, defaults.
//   3. The subscription_status CHECK rejects a bogus value.
//   4. DORMANCY: the bookable/searchable derivations do NOT yet reference
//      subscription_status (slice 2 adds that). So setting a practitioner to
//      'lapsed' now changes nothing — the feature is truly shipped-off.
//   5. effectiveSubscriptionCents logic (replicated): default / exempt / custom.
//
// Requires migration 20260829140000 applied. Run:
//   node --env-file=.env.local scripts/verify-subscription-slice1.mjs
import { createClient } from "@supabase/supabase-js";

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SECRET = process.env.SUPABASE_SECRET_KEY;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const db = createClient(URL, SECRET);
const PW = "twelvecharspw1";
const stamp = Date.now();
const created = [];
let failures = 0;
const check = (label, cond, detail) => {
  if (!cond) failures++;
  console.log(`${cond ? "PASS" : "FAIL"} — ${label}${detail !== undefined ? `  (${detail})` : ""}`);
};

// Replica of effectiveSubscriptionCents (lib/payments/stripe/subscription.ts).
const DEFAULT_CENTS = process.env.SUBSCRIPTION_PRICE_CENTS && process.env.SUBSCRIPTION_PRICE_CENTS.trim() !== "" ? Number(process.env.SUBSCRIPTION_PRICE_CENTS) : 1500;
const effectiveCents = (exempt, override) => (exempt ? 0 : override ?? DEFAULT_CENTS);

async function mkPractitioner(tag) {
  const email = `sub-${tag}-${stamp}@example.com`;
  const { data, error } = await db.auth.admin.createUser({
    email,
    password: PW,
    email_confirm: true,
    user_metadata: { role: "practitioner", display_name: `Sub ${tag} ${stamp}` },
  });
  if (error) throw error;
  created.push(data.user.id);
  for (let i = 0; i < 20; i++) {
    if ((await db.from("practitioner_profiles").select("id").eq("id", data.user.id).maybeSingle()).data) break;
    await new Promise((r) => setTimeout(r, 200));
  }
  await db.from("practitioner_profiles").update({ username: `sub${tag}${stamp}`, timezone: "Europe/Sofia" }).eq("id", data.user.id);
  return { id: data.user.id, email };
}

async function main() {
  console.log(`=== Setup (default fee = ${DEFAULT_CENTS}c) ===`);
  const p = await mkPractitioner("a");

  // 1. Column defaults on a fresh row.
  console.log("\n=== 1. Column defaults ===");
  const { data: row } = await db
    .from("practitioner_profiles")
    .select("subscription_status, subscription_exempt, subscription_price_override_cents, subscription_current_period_end, stripe_customer_id, stripe_subscription_id")
    .eq("id", p.id)
    .single();
  check("subscription_status defaults not_required", row?.subscription_status === "not_required", row?.subscription_status);
  check("subscription_exempt defaults false", row?.subscription_exempt === false);
  check("price override null by default", row?.subscription_price_override_cents === null);
  check("no stripe_customer_id yet", row?.stripe_customer_id === null);
  check("no stripe_subscription_id yet", row?.stripe_subscription_id === null);

  // 2. get_my_subscription_context returns the caller's own row.
  console.log("\n=== 2. get_my_subscription_context (as the practitioner) ===");
  const asUser = createClient(URL, ANON);
  await asUser.auth.signInWithPassword({ email: p.email, password: PW });
  const { data: ctx, error: ctxErr } = await asUser.rpc("get_my_subscription_context").single();
  check("RPC callable by the practitioner", !ctxErr, ctxErr?.message);
  check("RPC returns status not_required", ctx?.subscription_status === "not_required", ctx?.subscription_status);
  check("RPC exempt false", ctx?.subscription_exempt === false);
  check("RPC has_customer false", ctx?.has_customer === false);
  check("RPC has_subscription false", ctx?.has_subscription === false);

  // 3. CHECK constraint rejects a bogus status.
  console.log("\n=== 3. subscription_status CHECK ===");
  const { error: badStatus } = await db.from("practitioner_profiles").update({ subscription_status: "bananas" }).eq("id", p.id);
  check("rejects an invalid status", !!badStatus, badStatus?.code);
  for (const s of ["active", "grace", "lapsed", "exempt", "not_required"]) {
    const { error } = await db.from("practitioner_profiles").update({ subscription_status: s }).eq("id", p.id);
    check(`accepts '${s}'`, !error, error?.message);
  }

  // 4. Dormancy — the derivations don't act on subscription_status yet (slice 2
  // adds that). Behavioural check: flip to 'lapsed' and confirm bookable/
  // searchable are unchanged vs 'not_required' for the same practitioner.
  console.log("\n=== 4. Dormancy (slice 2 adds enforcement, not now) ===");
  const readFlags = async () => {
    const b = (await db.rpc("is_practitioner_bookable", { target_practitioner_id: p.id })).data;
    const s = (await db.rpc("is_practitioner_searchable", { target_practitioner_id: p.id })).data;
    return { b, s };
  };
  await db.from("practitioner_profiles").update({ subscription_status: "not_required" }).eq("id", p.id);
  const baseline = await readFlags();
  await db.from("practitioner_profiles").update({ subscription_status: "lapsed" }).eq("id", p.id);
  const lapsed = await readFlags();
  check("bookable unchanged by lapsed (dormant)", baseline.b === lapsed.b, `${baseline.b} -> ${lapsed.b}`);
  check("searchable unchanged by lapsed (dormant)", baseline.s === lapsed.s, `${baseline.s} -> ${lapsed.s}`);

  // 5. Effective-fee resolution.
  console.log("\n=== 5. effectiveSubscriptionCents ===");
  check("default when no override", effectiveCents(false, null) === DEFAULT_CENTS, effectiveCents(false, null));
  check("exempt → 0", effectiveCents(true, null) === 0);
  check("exempt beats a custom amount", effectiveCents(true, 5000) === 0);
  check("custom amount honoured", effectiveCents(false, 2500) === 2500);

  console.log("\n=== Cleanup ===");
  for (const id of created) await db.auth.admin.deleteUser(id).catch(() => {});
  console.log(`\n${failures === 0 ? "ALL PASSED" : `${failures} FAILURE(S)`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
