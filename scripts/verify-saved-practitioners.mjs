// Save/favourite a practitioner — verification. Toggle from the profile, the
// saved dashboard section (separate from worked-with), unbookable-still-shows,
// the empty state, RLS isolation between clients, and the guest → login → return
// flow. Requires migration 20260817120000 applied.
// Run: node --env-file=.env.local scripts/verify-saved-practitioners.mjs
import { createClient } from "@supabase/supabase-js";
import { chromium } from "playwright";

const BASE = "http://localhost:3000";
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SECRET_KEY);
const PW = "twelvecharspw1";
const stamp = Date.now();
let failures = 0;
const created = [];
const check = (l, c, d) => { if (!c) failures++; console.log(`${c ? "PASS" : "FAIL"} — ${l}${d !== undefined ? `  (${d})` : ""}`); };

async function mk(role, name) {
  const email = `sv-${role}-${stamp}-${Math.random().toString(36).slice(2, 5)}@example.com`;
  const { data, error } = await db.auth.admin.createUser({ email, password: PW, email_confirm: true, user_metadata: { role, display_name: name } });
  if (error) throw error;
  created.push(data.user.id);
  await new Promise((r) => setTimeout(r, 400));
  return { id: data.user.id, email, name };
}
async function setupPractitioner(prac, uname) {
  for (let i = 0; i < 20; i++) { if ((await db.from("practitioner_profiles").select("id").eq("id", prac.id).maybeSingle()).data) break; await new Promise((r) => setTimeout(r, 200)); }
  await db.from("practitioner_profiles").update({ username: uname, timezone: "Europe/Sofia", avatar_url: "x", bio: "b", headline: "h", location: "Sofia", specialties: ["coaching"], billing_model: "software_provider" }).eq("id", prac.id);
  await db.from("practitioner_availability").insert([1, 2, 3, 4, 5, 6, 7].map((d) => ({ practitioner_id: prac.id, day_of_week: d, start_time: "00:00:00", end_time: "23:45:00" })));
  await db.from("services").insert({ practitioner_id: prac.id, name: "Svc", duration_minutes: 30, price_cents: 5000, currency: "EUR", is_active: true, delivery_type: "online", delivery_info: "x" });
}
const savedRow = async (clientId, pracId) =>
  (await db.from("saved_practitioners").select("id").eq("client_id", clientId).eq("practitioner_id", pracId).maybeSingle()).data;

(async () => {
  let browser;
  try {
    console.log("=== Setup ===");
    const A = await mk("client", `Client A ${stamp}`);
    const B = await mk("client", `Client B ${stamp}`);
    const C = await mk("client", `Client C ${stamp}`);
    const D = await mk("client", `Client D ${stamp}`);
    const pracBooked = await mk("practitioner", `Booked ${stamp}`);
    const pracSaved = await mk("practitioner", `Saved ${stamp}`);
    await setupPractitioner(pracBooked, `bk${stamp}`);
    await setupPractitioner(pracSaved, `sv${stamp}`);
    // A/B/C each have a past booking with pracBooked (→ full dashboard + worked-
    // with). A will SAVE pracSaved; B and C save nothing.
    const pracBookedSvc = (await db.from("services").select("id").eq("practitioner_id", pracBooked.id).single()).data.id;
    const bookingFor = (clientId) =>
      db.from("bookings").insert({ practitioner_id: pracBooked.id, client_id: clientId, service_id: pracBookedSvc, start_utc: new Date(Date.now() - 864e5).toISOString(), end_utc: new Date(Date.now() - 864e5 + 18e5).toISOString(), delivery_type: "online", service_name: "Svc", price_cents: 5000, currency: "EUR", status: "completed" });
    await bookingFor(A.id);
    await bookingFor(B.id);
    await bookingFor(C.id);
    // D has NO bookings but HAS a save — must still see the saved section, not the
    // onboarding/activation screen.
    await db.from("saved_practitioners").insert({ client_id: D.id, practitioner_id: pracSaved.id });

    browser = await chromium.launch();
    const ctx = await browser.newContext();
    await ctx.grantPermissions(["notifications"], { origin: BASE });
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

    console.log("\n=== 1. Toggle save from the profile ===");
    await loginAs(A.email);
    await page.goto(`${BASE}/bg/p/sv${stamp}`, { waitUntil: "networkidle" });
    await page.getByRole("button", { name: "Запази практикуващ" }).first().click();
    await page.waitForTimeout(1200);
    check("save → row created for (A, pracSaved)", !!(await savedRow(A.id, pracSaved.id)));
    check("control now shows saved state", await page.getByRole("button", { name: "Запазено" }).first().isVisible().catch(() => false));
    await page.getByRole("button", { name: "Запазено" }).first().click();
    await page.waitForTimeout(1200);
    check("unsave → row removed", !(await savedRow(A.id, pracSaved.id)));
    // Re-save for the following checks.
    await page.getByRole("button", { name: "Запази практикуващ" }).first().click();
    await page.waitForTimeout(1200);
    check("re-save → row present", !!(await savedRow(A.id, pracSaved.id)));

    console.log("\n=== 2. Dashboard: saved is separate from worked-with ===");
    await page.goto(`${BASE}/bg/client-dashboard`, { waitUntil: "networkidle" });
    const savedSection = page.locator("#saved");
    const workedSection = page.locator("#practitioners");
    check("saved section shows pracSaved", await savedSection.getByText(`Saved ${stamp}`).first().isVisible().catch(() => false));
    check("worked-with shows pracBooked", await workedSection.getByText(`Booked ${stamp}`).first().isVisible().catch(() => false));
    check("saved does NOT list the merely-booked one", !(await savedSection.getByText(`Booked ${stamp}`).first().isVisible().catch(() => false)));
    check("worked-with does NOT list the save-only one", !(await workedSection.getByText(`Saved ${stamp}`).first().isVisible().catch(() => false)));

    console.log("\n=== 3. Unbookable/suspended saved practitioner still shows, no booking action ===");
    await db.from("practitioner_profiles").update({ moderation_status: "suspended" }).eq("id", pracSaved.id);
    await page.goto(`${BASE}/bg/client-dashboard`, { waitUntil: "networkidle" });
    check("suspended saved practitioner still appears", await page.locator("#saved").getByText(`Saved ${stamp}`).first().isVisible().catch(() => false));
    check("shows 'not taking bookings', no book CTA", await page.locator("#saved").getByText("В момента не приема резервации").first().isVisible().catch(() => false));
    await db.from("practitioner_profiles").update({ moderation_status: "active" }).eq("id", pracSaved.id);

    console.log("\n=== 4. Empty state (client with bookings but no saves) ===");
    await loginAs(C.email);
    await page.goto(`${BASE}/bg/client-dashboard`, { waitUntil: "networkidle" });
    check("empty state line shown", await page.locator("#saved").getByText("Запазвайте практикуващи").first().isVisible().catch(() => false));

    console.log("\n=== 4b. No bookings but has a save → saved section still shown (not activation) ===");
    await loginAs(D.email);
    await page.goto(`${BASE}/bg/client-dashboard`, { waitUntil: "networkidle" });
    check("no-booking client with a save sees the saved section", await page.locator("#saved").getByText(`Saved ${stamp}`).first().isVisible().catch(() => false));

    console.log("\n=== 5. RLS: another client cannot see A's saves ===");
    await loginAs(B.email);
    await page.goto(`${BASE}/bg/client-dashboard`, { waitUntil: "networkidle" });
    check("B's saved section does NOT show A's saved practitioner", !(await page.locator("#saved").getByText(`Saved ${stamp}`).first().isVisible().catch(() => false)));
    check("B sees the empty state instead", await page.locator("#saved").getByText("Запазвайте практикуващи").first().isVisible().catch(() => false));

    console.log("\n=== 6. Guest → login(next) → returned to the practitioner ===");
    await ctx.clearCookies();
    await page.goto(`${BASE}/bg/p/sv${stamp}`, { waitUntil: "networkidle" });
    await page.getByRole("button", { name: "Запази практикуващ" }).first().click();
    await page.waitForURL((u) => u.pathname.includes("/login"), { timeout: 15000 });
    check("guest save routes to login with a next param", page.url().includes("next="), page.url().slice(-60));
    await page.fill('input[name="email"]', A.email);
    await page.fill('input[name="password"]', PW);
    await page.click('button[type="submit"]');
    await page.waitForURL((u) => u.pathname.includes(`/p/sv${stamp}`), { timeout: 20000 });
    check("returned to the practitioner profile after login", page.url().includes(`/p/sv${stamp}`));
  } catch (err) {
    console.error("\n!!! aborted:", err.stack || err.message);
    failures++;
  } finally {
    if (browser) await browser.close();
    for (const id of created) {
      await db.from("saved_practitioners").delete().or(`client_id.eq.${id},practitioner_id.eq.${id}`);
      await db.from("bookings").delete().eq("practitioner_id", id);
      await db.from("bookings").delete().eq("client_id", id);
    }
    for (const id of created) await db.auth.admin.deleteUser(id).catch(() => {});
    console.log(`\ncleaned up ${created.length} users`);
    console.log(failures === 0 ? "ALL PASS ✓" : `${failures} FAIL ✗`);
    process.exit(failures === 0 ? 0 : 1);
  }
})();
