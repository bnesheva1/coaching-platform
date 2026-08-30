// In-person delivery hidden via ENABLED_DELIVERY_TYPES — verification.
//
// Genuinely hides (not just visually):
//   - service form offers NO in_person option (and none for phone)
//   - a FORGED in_person submit is rejected server-side (no service created)
//   - /browse?deliveryType=in_person is stripped server-side (no active filter,
//     no in_person chip)
//   - 0 in_person services remain in the DB (seed converted)
//   - config logic: unset -> online only; reversible when in_person is listed
//
// Requires the dev server running with ENABLED_DELIVERY_TYPES unset or "online".
// Run: node --env-file=.env.local scripts/verify-delivery-types-hidden.mjs
import { createClient } from "@supabase/supabase-js";
import { chromium } from "playwright";
import bg from "../messages/bg.json" with { type: "json" };

const BASE = "http://localhost:3000";
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SECRET_KEY);
const PW = "twelvecharspw1";
const stamp = Date.now();
const created = [];
let failures = 0;
const check = (l, c, d) => { if (!c) failures++; console.log(`${c ? "PASS" : "FAIL"} — ${l}${d !== undefined ? `  (${d})` : ""}`); };

const IN_PERSON_LABEL = bg.Services.deliveryTypeInPerson;   // "На място"
const ONLINE_LABEL = bg.Services.deliveryTypeOnline;

// Replica of lib/delivery.ts enabledDeliveryTypes (node can't import the .ts).
function enabledFor(envVal) {
  const set = new Set(["online"]);
  if (envVal) for (const p of envVal.split(",")) { const v = p.trim().toLowerCase(); if (v === "in_person" || v === "phone") set.add(v); }
  return set;
}

async function main() {
  console.log("=== 1. Config logic (unset = online-only; reversible) ===");
  check("unset -> {online}", [...enabledFor(undefined)].join() === "online");
  check("'online' -> {online}", [...enabledFor("online")].join() === "online");
  check("in_person NOT offered by default", !enabledFor(undefined).has("in_person"));
  check("reversible: 'online,in_person' offers in_person", enabledFor("online,in_person").has("in_person"));
  check("online always on even if omitted: 'in_person' -> has online", enabledFor("in_person").has("online"));

  console.log("\n=== 2. DB: no in_person services remain ===");
  const { data: svcs } = await db.from("services").select("id").eq("delivery_type", "in_person");
  check("0 in_person services", (svcs?.length ?? 0) === 0, svcs?.length);

  console.log("\n=== Setup practitioner ===");
  const email = `deliv-${stamp}@example.com`;
  const { data: u, error } = await db.auth.admin.createUser({ email, password: PW, email_confirm: true, user_metadata: { role: "practitioner", display_name: `Deliv ${stamp}` } });
  if (error) throw error;
  created.push(u.user.id);
  for (let i = 0; i < 20; i++) { if ((await db.from("practitioner_profiles").select("id").eq("id", u.user.id).maybeSingle()).data) break; await new Promise((r) => setTimeout(r, 200)); }
  await db.from("practitioner_profiles").update({ username: `deliv${stamp}`, timezone: "Europe/Sofia" }).eq("id", u.user.id);

  const browser = await chromium.launch();
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  page.on("pageerror", (e) => console.log("  [pageerror]", e.message.slice(0, 160)));
  try {
    await page.goto(`${BASE}/bg/login`, { waitUntil: "domcontentloaded" });
    await page.fill('input[name="email"]', email);
    await page.fill('input[name="password"]', PW);
    await page.click('button[type="submit"]');
    await page.waitForURL((u2) => !u2.pathname.includes("/login"), { timeout: 30000 });

    console.log("\n=== 3. Service form: no in_person / phone option ===");
    await page.goto(`${BASE}/bg/practitioner-dashboard/services`, { waitUntil: "networkidle" });
    await page.getByRole("button", { name: "Добави друга услуга" }).first().click();
    const sel = page.locator('select[name="deliveryType"]').first();
    await sel.waitFor();
    const optionValues = await sel.locator("option").evaluateAll((opts) => opts.map((o) => o.value));
    check("select has online", optionValues.includes("online"), optionValues.join());
    check("select has NO in_person option", !optionValues.includes("in_person"), optionValues.join());
    check("select has NO phone option", !optionValues.includes("phone"));

    console.log("\n=== 4. Forged in_person submit rejected server-side ===");
    await page.locator('input[name="name"]').first().fill(`Forged ${stamp}`);
    await page.locator('input[name="price"]').first().fill("50");
    // Force the select to submit in_person despite no such option (bypass the UI).
    await sel.evaluate((node) => {
      const o = document.createElement("option"); o.value = "in_person"; o.text = "forged"; node.appendChild(o);
      node.value = "in_person"; node.dispatchEvent(new Event("change", { bubbles: true }));
    });
    // Submit the add-service form.
    await page.locator('form:has(select[name="deliveryType"]) button[type="submit"]').first().click();
    await page.waitForTimeout(1500);
    const { data: forged } = await db.from("services").select("id, delivery_type").eq("practitioner_id", u.user.id).eq("delivery_type", "in_person");
    check("no in_person service was created by the forged submit", (forged?.length ?? 0) === 0, forged?.length);

    console.log("\n=== 5. Browse filter: in_person not offered, URL value stripped ===");
    await page.goto(`${BASE}/bg/browse?deliveryType=in_person`, { waitUntil: "networkidle" });
    // getByText matches rendered element text only (ignores <script> data like
    // the serialized next-intl message bundle, which does contain the label).
    const onlineVisible = await page.getByText(ONLINE_LABEL, { exact: false }).first().isVisible().catch(() => false);
    const inPersonCount = await page.getByText(IN_PERSON_LABEL, { exact: true }).count();
    check("browse renders the delivery filter (online present)", onlineVisible);
    check("no visible in_person filter option/chip", inPersonCount === 0, `visible occurrences: ${inPersonCount}`);
  } finally {
    await browser.close();
  }

  console.log("\n=== Cleanup ===");
  for (const id of created) { await db.from("services").delete().eq("practitioner_id", id); await db.auth.admin.deleteUser(id).catch(() => {}); }
  console.log(`\n${failures === 0 ? "ALL PASSED" : `${failures} FAILURE(S)`}`);
  process.exit(failures === 0 ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
