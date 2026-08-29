// Subscription billing — slice 3 (admin surface) verification.
//   - admin_list_practitioners returns the 6 new subscription columns
//   - browser: an admin sets a custom fee / marks exempt / clears, each with a
//     reason → row columns + status transitions + audit-log rows; reason
//     required; independence from the commission override
//
// Requires migrations 20260829140000/150000/160000 applied AND the dev server
// running. Playwright installed --no-save.
// Run: node --env-file=.env.local scripts/verify-subscription-slice3.mjs
import { createClient } from "@supabase/supabase-js";
import { chromium } from "playwright";

const BASE = "http://localhost:3000";
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SECRET_KEY);
const DEFAULT_CENTS = process.env.SUBSCRIPTION_PRICE_CENTS && process.env.SUBSCRIPTION_PRICE_CENTS.trim() !== "" ? Number(process.env.SUBSCRIPTION_PRICE_CENTS) : 1500;
const PW = "twelvecharspw1";
const stamp = Date.now();
const created = [];
let failures = 0;
const check = (l, c, d) => { if (!c) failures++; console.log(`${c ? "PASS" : "FAIL"} — ${l}${d !== undefined ? `  (${d})` : ""}`); };

async function mkUser(role, name) {
  const email = `sub3-${role}-${stamp}@example.com`;
  const { data, error } = await db.auth.admin.createUser({ email, password: PW, email_confirm: true, user_metadata: { role, display_name: name } });
  if (error) throw error;
  created.push(data.user.id);
  await new Promise((r) => setTimeout(r, 300));
  return { id: data.user.id, email };
}
const pracRow = async (id) =>
  (await db.from("practitioner_profiles")
    .select("subscription_exempt, subscription_price_override_cents, subscription_status, subscription_override_reason, subscription_override_set_by, commission_rate_override")
    .eq("id", id).single()).data;
const lastAudit = async (action) =>
  (await db.from("admin_audit_log").select("action, new_value").eq("action", action).order("created_at", { ascending: false }).limit(1)).data?.[0];

async function main() {
  console.log("=== Setup ===");
  const admin = await mkUser("client", `Sub3 Admin ${stamp}`);
  await db.from("profiles").update({ role: "admin" }).eq("id", admin.id);
  const prac = await mkUser("practitioner", `Sub3 Prac ${stamp}`);
  for (let i = 0; i < 20; i++) { if ((await db.from("practitioner_profiles").select("id").eq("id", prac.id).maybeSingle()).data) break; await new Promise((r) => setTimeout(r, 200)); }
  const uname = `sub3${stamp}`;
  await db.from("practitioner_profiles").update({ username: uname, timezone: "Europe/Sofia", billing_model: "software_provider" }).eq("id", prac.id);

  console.log("\n=== admin_list_practitioners surfaces subscription columns ===");
  const row0 = ((await db.rpc("admin_list_practitioners", { search: uname })).data ?? []).find((r) => r.id === prac.id);
  check("RPC returns the practitioner", !!row0);
  check("subscription_status present (not_required)", row0?.subscription_status === "not_required", row0?.subscription_status);
  check("subscription_exempt present (false)", row0?.subscription_exempt === false);
  check("subscription_price_override_cents present (null)", row0?.subscription_price_override_cents === null);
  check("subscription_override_reason column present", "subscription_override_reason" in (row0 ?? {}));
  check("subscription_override_set_at column present", "subscription_override_set_at" in (row0 ?? {}));
  check("subscription_current_period_end column present", "subscription_current_period_end" in (row0 ?? {}));

  console.log("\n=== Browser: admin drives the subscription dialog ===");
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
  async function openDialog() {
    await page.goto(`${BASE}/bg/admin/practitioners?q=${uname}`, { waitUntil: "networkidle" });
    await page.getByRole("button", { name: "Задай абонамент" }).first().click();
    return page.locator("dialog", { has: page.locator('input[name="price"]') });
  }

  try {
    await loginAs(admin.email);

    // 1. Custom fee €12 + reason. Status stays not_required (pure price change).
    let dlg = await openDialog();
    check("admin can open the subscription dialog", await dlg.isVisible().catch(() => false));
    await dlg.locator('input[name="price"]').fill("12");
    await dlg.locator('textarea[name="reason"]').fill("smaller practice deal");
    await dlg.locator('button[type="submit"]').click();
    await page.waitForTimeout(1500);
    let r = await pracRow(prac.id);
    check("custom fee stored as 1200 cents", r?.subscription_price_override_cents === 1200, r?.subscription_price_override_cents);
    check("reason recorded", r?.subscription_override_reason === "smaller practice deal");
    check("set_by = admin", r?.subscription_override_set_by === admin.id);
    check("not exempt", r?.subscription_exempt === false);
    check("status untouched by a price change (not_required)", r?.subscription_status === "not_required", r?.subscription_status);
    check("commission override untouched (independent axis)", r?.commission_rate_override === null);
    check("audit subscription:set written", (await lastAudit("practitioner.subscription:set"))?.new_value?.includes("smaller practice deal"));

    // 2. Mark exempt → status 'exempt', price cleared (disabled field not submitted).
    dlg = await openDialog();
    await dlg.locator('input[type="checkbox"]').check();
    await dlg.locator('textarea[name="reason"]').fill("founding partner");
    await dlg.locator('button[type="submit"]').click();
    await page.waitForTimeout(1500);
    r = await pracRow(prac.id);
    check("now exempt", r?.subscription_exempt === true);
    check("status transitioned to 'exempt'", r?.subscription_status === "exempt", r?.subscription_status);
    check("exempt reason recorded", r?.subscription_override_reason === "founding partner");

    // 3. Clear (uncheck exempt, empty price) → back to not_required, price null.
    dlg = await openDialog();
    // Was exempt → checkbox starts checked; uncheck it and leave price empty.
    await dlg.locator('input[type="checkbox"]').uncheck();
    await dlg.locator('input[name="price"]').fill("");
    await dlg.locator('textarea[name="reason"]').fill("back to standard terms");
    await dlg.locator('button[type="submit"]').click();
    await page.waitForTimeout(1500);
    r = await pracRow(prac.id);
    check("no longer exempt", r?.subscription_exempt === false);
    check("status back to 'not_required'", r?.subscription_status === "not_required", r?.subscription_status);
    check("price override cleared to null", r?.subscription_price_override_cents === null);
    check("reason cleared (no override active)", r?.subscription_override_reason === null);
    check("audit subscription:clear written", !!(await lastAudit("practitioner.subscription:clear")));

    // 4. Reason required.
    dlg = await openDialog();
    await dlg.locator('input[name="price"]').fill("20");
    await dlg.locator('button[type="submit"]').click();
    await page.waitForTimeout(1000);
    const stillOpen = await dlg.isVisible().catch(() => false);
    check("dialog stays open when reason is missing", stillOpen === true);
    const rNo = await pracRow(prac.id);
    check("no write on missing reason", rNo?.subscription_price_override_cents === null);
  } finally {
    await browser.close();
  }

  console.log(`\n(default fee shown as €${(DEFAULT_CENTS / 100).toFixed(2)}/mo)`);
  console.log("\n=== Cleanup ===");
  for (const id of created) await db.auth.admin.deleteUser(id).catch(() => {});
  console.log(`\n${failures === 0 ? "ALL PASSED" : `${failures} FAILURE(S)`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
