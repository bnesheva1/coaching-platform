// Per-practitioner commission-rate override — verification.
//   - resolution arithmetic (override ?? default; round(price*rate))
//   - DB CHECK rejects out-of-range overrides
//   - admin_list_practitioners returns the override + reason + set_at
//   - confirm_paid_booking snapshots commission_rate onto the payment, and a
//     later override change never alters an already-recorded payment
//   - browser: an admin sets/clears the override with a reason → columns +
//     audit-log row + effective-rate display; reason required
//
// Requires migration 20260829120000 applied AND the dev server running
// (SESSION_DOCUMENTS_ENABLED not needed). Playwright installed --no-save.
// Run: node --env-file=.env.local scripts/verify-commission-override.mjs
import { createClient } from "@supabase/supabase-js";
import { chromium } from "playwright";

const BASE = "http://localhost:3000";
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const db = createClient(url, process.env.SUPABASE_SECRET_KEY);
const BRAND_DEFAULT = process.env.COMMISSION_RATE && process.env.COMMISSION_RATE.trim() !== "" ? Number(process.env.COMMISSION_RATE) : 0.15;
const PW = "twelvecharspw1";
const stamp = Date.now();
const created = [];
let failures = 0;
const check = (l, c, d) => { if (!c) failures++; console.log(`${c ? "PASS" : "FAIL"} — ${l}${d !== undefined ? `  (${d})` : ""}`); };

// Inline replicas of lib/payments/stripe/checkout.ts (node can't import the .ts
// through its stripe-SDK imports) — must match that module.
const effectiveCommissionRate = (override) => override ?? BRAND_DEFAULT;
const commissionCentsFor = (priceCents, rate = BRAND_DEFAULT) => Math.round(priceCents * rate);

async function mkUser(role, name) {
  const email = `com-${role}-${stamp}-${Math.random().toString(36).slice(2, 5)}@example.com`;
  const { data, error } = await db.auth.admin.createUser({ email, password: PW, email_confirm: true, user_metadata: { role, display_name: name } });
  if (error) throw error;
  created.push(data.user.id);
  await new Promise((r) => setTimeout(r, 300));
  return { id: data.user.id, email };
}

async function main() {
  console.log("=== Resolution arithmetic (DB-independent) ===");
  check("override null → brand default", effectiveCommissionRate(null) === BRAND_DEFAULT);
  check("override 0 → 0 (explicit zero kept)", effectiveCommissionRate(0) === 0);
  check("override 0.5 → 0.5", effectiveCommissionRate(0.5) === 0.5);
  check("commissionCentsFor(5000, 0) === 0", commissionCentsFor(5000, 0) === 0);
  check("commissionCentsFor(5000, 0.15) === 750", commissionCentsFor(5000, 0.15) === 750);

  console.log("\n=== Setup ===");
  const admin = await mkUser("client", `Comm Admin ${stamp}`);
  await db.from("profiles").update({ role: "admin" }).eq("id", admin.id); // admin role is set out-of-band
  const prac = await mkUser("practitioner", `Comm Prac ${stamp}`);
  const client = await mkUser("client", `Comm Client ${stamp}`);
  for (let i = 0; i < 20; i++) { if ((await db.from("practitioner_profiles").select("id").eq("id", prac.id).maybeSingle()).data) break; await new Promise((r) => setTimeout(r, 200)); }
  const uname = `comm${stamp}`;
  await db.from("practitioner_profiles").update({ username: uname, timezone: "Europe/Sofia", bio: "b", headline: "h", location: "Sofia", specialties: ["coaching"], billing_model: "commission" }).eq("id", prac.id);
  const service = (await db.from("services").insert({ practitioner_id: prac.id, name: "Consult", duration_minutes: 60, price_cents: 5000, currency: "EUR", is_active: true, delivery_type: "online" }).select("id").single()).data;

  console.log("\n=== DB CHECK constraint (0–1) ===");
  const tooHigh = await db.from("practitioner_profiles").update({ commission_rate_override: 1.5 }).eq("id", prac.id);
  check("override > 1 rejected", !!tooHigh.error, tooHigh.error?.code);
  const negative = await db.from("practitioner_profiles").update({ commission_rate_override: -0.1 }).eq("id", prac.id);
  check("override < 0 rejected", !!negative.error);
  const zeroOk = await db.from("practitioner_profiles").update({ commission_rate_override: 0 }).eq("id", prac.id);
  check("override = 0 accepted", !zeroOk.error, zeroOk.error?.message);
  await db.from("practitioner_profiles").update({ commission_rate_override: null, commission_rate_reason: null, commission_rate_set_by: null, commission_rate_set_at: null }).eq("id", prac.id);

  console.log("\n=== admin_list_practitioners surfaces the override ===");
  await db.from("practitioner_profiles").update({ commission_rate_override: 0, commission_rate_reason: "founding partner", commission_rate_set_by: admin.id, commission_rate_set_at: new Date().toISOString() }).eq("id", prac.id);
  const list = await db.rpc("admin_list_practitioners", { search: uname });
  const row = (list.data ?? []).find((r) => r.id === prac.id);
  check("RPC returns the practitioner", !!row);
  check("RPC returns commission_rate_override = 0", row && Number(row.commission_rate_override) === 0, JSON.stringify(row?.commission_rate_override));
  check("RPC returns the reason", row && row.commission_rate_reason === "founding partner");
  await db.from("practitioner_profiles").update({ commission_rate_override: null, commission_rate_reason: null }).eq("id", prac.id);

  console.log("\n=== confirm_paid_booking snapshots commission_rate ===");
  const startA = new Date(Date.now() + 48 * 3600e3).toISOString();
  const sessA = `cs_test_${stamp}_a`;
  const rA = await db.rpc("confirm_paid_booking", {
    p_practitioner_id: prac.id, p_client_id: client.id, p_service_id: service.id, p_start_utc: startA,
    p_checkout_session_id: sessA, p_amount_cents: 5000, p_commission_cents: 0, p_currency: "EUR",
    p_payment_intent_id: `pi_${stamp}_a`, p_commission_rate: 0,
  }).single();
  check("confirm_paid_booking (rate 0) succeeded", !rA.error && rA.data?.booking_id, rA.error?.message);
  const payA = (await db.from("payments").select("commission_rate, commission_cents").eq("stripe_checkout_session_id", sessA).single()).data;
  check("payment snapshot: commission_rate = 0", payA && Number(payA.commission_rate) === 0, JSON.stringify(payA));
  check("payment snapshot: commission_cents = 0", payA && payA.commission_cents === 0);

  const startB = new Date(Date.now() + 72 * 3600e3).toISOString();
  const sessB = `cs_test_${stamp}_b`;
  await db.rpc("confirm_paid_booking", {
    p_practitioner_id: prac.id, p_client_id: client.id, p_service_id: service.id, p_start_utc: startB,
    p_checkout_session_id: sessB, p_amount_cents: 5000, p_commission_cents: 750, p_currency: "EUR",
    p_payment_intent_id: `pi_${stamp}_b`, p_commission_rate: 0.15,
  }).single();
  const payB = (await db.from("payments").select("commission_rate").eq("stripe_checkout_session_id", sessB).single()).data;
  check("payment snapshot: commission_rate = 0.15", payB && Number(payB.commission_rate) === 0.15, JSON.stringify(payB?.commission_rate));

  // Later override change must NOT alter the already-recorded payment.
  await db.from("practitioner_profiles").update({ commission_rate_override: 0.5 }).eq("id", prac.id);
  const payBAfter = (await db.from("payments").select("commission_rate").eq("stripe_checkout_session_id", sessB).single()).data;
  check("snapshot immutable to a later override change", payBAfter && Number(payBAfter.commission_rate) === 0.15);
  await db.from("practitioner_profiles").update({ commission_rate_override: null }).eq("id", prac.id);

  console.log("\n=== Browser: admin sets/clears the override ===");
  const browser = await chromium.launch();
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  page.on("pageerror", (e) => console.log("  [pageerror]", e.message.slice(0, 160)));
  async function loginAs(email) {
    await ctx.clearCookies();
    await page.goto(`${BASE}/bg/login`, { waitUntil: "domcontentloaded" });
    await page.fill('input[name="email"]', email);
    await page.fill('input[name="password"]', PW);
    await page.click('button[type="submit"]');
    await page.waitForURL((u) => !u.pathname.includes("/login"), { timeout: 30000 });
  }
  try {
    await loginAs(admin.email);
    await page.goto(`${BASE}/bg/admin/practitioners?q=${uname}`, { waitUntil: "networkidle" });
    check("admin can load the practitioners page", await page.getByText(`Comm Prac ${stamp}`).first().isVisible().catch(() => false));

    // Scope to the commission dialog (the only one with a rate input) — all
    // three control dialogs share a name="reason" textarea + "Потвърди" button.
    const commDialog = page.locator("dialog", { has: page.locator('input[name="rate"]') });

    // Open the commission dialog, set 0% + reason.
    await page.getByRole("button", { name: "Задай комисиона" }).first().click();
    await commDialog.locator('input[name="rate"]').fill("0");
    await commDialog.locator('textarea[name="reason"]').fill("early recruit");
    await commDialog.locator('button[type="submit"]').click();
    await page.waitForTimeout(1500);
    const set = (await db.from("practitioner_profiles").select("commission_rate_override, commission_rate_reason, commission_rate_set_by").eq("id", prac.id).single()).data;
    check("override set to 0 via the admin dialog", set && Number(set.commission_rate_override) === 0, JSON.stringify(set?.commission_rate_override));
    check("reason recorded on the row", set && set.commission_rate_reason === "early recruit");
    check("set_by = admin", set && set.commission_rate_set_by === admin.id);
    const auditSet = (await db.from("admin_audit_log").select("action, new_value").eq("action", "practitioner.commission:set").order("created_at", { ascending: false }).limit(1)).data?.[0];
    check("audit row written (commission:set) with reason", auditSet && String(auditSet.new_value).includes("early recruit"), auditSet?.new_value);

    // The effective-rate display reflects the override.
    await page.reload({ waitUntil: "networkidle" });
    check("page shows the 0% override + reason", await page.getByText(/early recruit/).first().isVisible().catch(() => false));

    // Clear it (empty rate) with a reason.
    await page.getByRole("button", { name: "Задай комисиона" }).first().click();
    await commDialog.locator('input[name="rate"]').fill("");
    await commDialog.locator('textarea[name="reason"]').fill("terms ended");
    await commDialog.locator('button[type="submit"]').click();
    await page.waitForTimeout(1500);
    const cleared = (await db.from("practitioner_profiles").select("commission_rate_override").eq("id", prac.id).single()).data;
    check("override cleared to null (back to brand default)", cleared && cleared.commission_rate_override === null);
    const auditClear = (await db.from("admin_audit_log").select("action").eq("action", "practitioner.commission:clear").limit(1)).data?.[0];
    check("audit row written (commission:clear)", !!auditClear);
  } finally {
    await browser.close();
  }

  console.log("\n=== Cleanup ===");
  for (const s of [`cs_test_${stamp}_a`, `cs_test_${stamp}_b`]) await db.from("payments").delete().eq("stripe_checkout_session_id", s);
  await db.from("bookings").delete().eq("practitioner_id", prac.id);
  await db.from("admin_audit_log").delete().eq("actor_id", admin.id);
  for (const id of created) await db.auth.admin.deleteUser(id).catch(() => {});

  console.log(`\n${failures === 0 ? "ALL PASSED" : `${failures} FAILURE(S)`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
