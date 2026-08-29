// Practitioner earnings panel — verification.
//   - Zero case (software_provider): "the full amount", no "0% commission".
//   - Commission case (brand default): rate %, exact commission + net.
//   - Override flows through: a commission practitioner with a 10% override
//     shows 10% (NOT the brand default) — proves the panel reads the same
//     effectiveCommissionRate checkout uses.
// Requires migration 20260829130000 applied + the dev server running. Playwright.
// Run: node --env-file=.env.local scripts/verify-earnings-panel.mjs
import { createClient } from "@supabase/supabase-js";
import { chromium } from "playwright";

const BASE = "http://localhost:3000";
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SECRET_KEY);
const BRAND = process.env.COMMISSION_RATE && process.env.COMMISSION_RATE.trim() !== "" ? Number(process.env.COMMISSION_RATE) : 0.15;
const PW = "twelvecharspw1";
const stamp = Date.now();
const created = [];
let failures = 0;
const check = (l, c, d) => { if (!c) failures++; console.log(`${c ? "PASS" : "FAIL"} — ${l}${d !== undefined ? `  (${d})` : ""}`); };
// bg currency: "50,00 €" — we assert on the numeric part.
const bg = (cents) => (cents / 100).toFixed(2).replace(".", ",");

async function mkPrac(tag, billingModel, override) {
  const email = `earn-${tag}-${stamp}@example.com`;
  const { data, error } = await db.auth.admin.createUser({ email, password: PW, email_confirm: true, user_metadata: { role: "practitioner", display_name: `Earn ${tag} ${stamp}` } });
  if (error) throw error;
  created.push(data.user.id);
  for (let i = 0; i < 20; i++) { if ((await db.from("practitioner_profiles").select("id").eq("id", data.user.id).maybeSingle()).data) break; await new Promise((r) => setTimeout(r, 200)); }
  await db.from("practitioner_profiles").update({ username: `earn${tag}${stamp}`, timezone: "Europe/Sofia", bio: "b", headline: "h", location: "Sofia", specialties: ["coaching"], billing_model: billingModel, commission_rate_override: override }).eq("id", data.user.id);
  return { id: data.user.id, email };
}

async function main() {
  console.log(`=== Setup (brand default = ${BRAND * 100}%) ===`);
  const zeroP = await mkPrac("zero", "software_provider", null);
  const defP = await mkPrac("def", "commission", null);
  const ovrP = await mkPrac("ovr", "commission", 0.1);

  const browser = await chromium.launch();
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  page.on("pageerror", (e) => console.log("  [pageerror]", e.message.slice(0, 160)));
  const panel = page.locator('[role="group"][aria-label="Какво получавате"]');

  async function openPanel(email, priceCents) {
    await ctx.clearCookies();
    await page.goto(`${BASE}/bg/login`, { waitUntil: "domcontentloaded" });
    await page.fill('input[name="email"]', email);
    await page.fill('input[name="password"]', PW);
    await page.click('button[type="submit"]');
    await page.waitForURL((u) => !u.pathname.includes("/login"), { timeout: 30000 });
    await page.goto(`${BASE}/bg/practitioner-dashboard/services`, { waitUntil: "networkidle" });
    await page.getByRole("button", { name: "Добави друга услуга" }).first().click();
    await page.locator('input[name="price"]').fill(String(priceCents / 100));
    await page.waitForTimeout(400);
    return (await panel.textContent()) ?? "";
  }

  try {
    console.log("\n=== Zero (software_provider) ===");
    let txt = await openPanel(zeroP.email, 5000);
    check("full-amount row shown", txt.includes("Получавате пълната сума"));
    check("no commission row", !txt.includes("Комисиона на платформата"));
    check("shows 50,00", txt.includes("50,00"));

    console.log("\n=== Commission, brand default ===");
    txt = await openPanel(defP.email, 5000);
    if (BRAND > 0) {
      const pct = `${+(BRAND * 100).toFixed(2)}`;
      const commission = Math.round(5000 * BRAND);
      check(`commission row shows brand default ${pct}%`, txt.includes(`(${pct}%)`), txt.slice(0, 90));
      check(`commission amount −${bg(commission)}`, txt.includes(bg(commission)));
      check(`net ${bg(5000 - commission)}`, txt.includes(bg(5000 - commission)));
      check("no full-amount row", !txt.includes("Получавате пълната сума"));
    } else {
      check("brand default is 0 → full-amount row (zero brand)", txt.includes("Получавате пълната сума"));
    }

    console.log("\n=== Override flows through (10%, not the brand default) ===");
    txt = await openPanel(ovrP.email, 5000);
    check("commission row shows the 10% OVERRIDE", txt.includes("(10%)"), txt.slice(0, 90));
    check("commission amount −5,00 (10% of 50)", txt.includes("5,00"));
    check("net 45,00", txt.includes("45,00"));
    check("did NOT use the brand default rate", !txt.includes(`(${+(BRAND * 100).toFixed(2)}%)`) || BRAND === 0.1);
    check("no full-amount row (non-zero rate)", !txt.includes("Получавате пълната сума"));
  } finally {
    await browser.close();
  }

  console.log("\n=== Cleanup ===");
  for (const id of created) { await db.from("services").delete().eq("practitioner_id", id); await db.auth.admin.deleteUser(id).catch(() => {}); }
  console.log(`\n${failures === 0 ? "ALL PASSED" : `${failures} FAILURE(S)`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
