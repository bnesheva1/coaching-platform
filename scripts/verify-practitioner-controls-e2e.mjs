// Slice 2 verification: per-practitioner controls, end to end.
//  A) derivation matrix — the 4 statuses map correctly onto is_practitioner_
//     bookable / is_practitioner_searchable (the "one notion of bookable" claim).
//  B) live enforcement — a frozen practitioner is refused AT THE BOOKING ACTION
//     (stale-page case), a hidden one is still bookable by URL.
//  C) admin control UI — applying "freeze bookings" with a reason writes the
//     state + an audit row.
//  D) practitioner notice — the banner shows on their dashboard.
// Run: node --env-file=.env.local scripts/verify-practitioner-controls-e2e.mjs
import { createClient } from "@supabase/supabase-js";
import { chromium } from "playwright";

const BASE = "http://localhost:3000";
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SECRET_KEY);
const PW = "twelvecharspw1";
const stamp = Date.now();
let failures = 0;
const created = [];
function check(label, cond, detail) {
  if (!cond) failures++;
  console.log(`${cond ? "PASS" : "FAIL"} — ${label}${detail !== undefined ? `  (${detail})` : ""}`);
}
async function mk(role, name) {
  const email = `pc-${role}-${stamp}-${Math.random().toString(36).slice(2, 5)}@example.com`;
  const { data, error } = await db.auth.admin.createUser({ email, password: PW, email_confirm: true, user_metadata: { role, display_name: name } });
  if (error) throw error;
  created.push(data.user.id);
  await new Promise((r) => setTimeout(r, 400));
  return { id: data.user.id, email };
}
const bookable = async (id) => (await db.rpc("is_practitioner_bookable", { target_practitioner_id: id })).data;
const searchable = async (id) => (await db.rpc("is_practitioner_searchable", { target_practitioner_id: id })).data;
const setMod = (id, s) => db.from("practitioner_profiles").update({ moderation_status: s }).eq("id", id);

async function login(page, email) {
  await page.goto(`${BASE}/bg/login`, { waitUntil: "domcontentloaded" });
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', PW);
  await page.click('button[type="submit"]');
  await page.waitForURL((u) => !u.pathname.includes("/login"), { timeout: 30000 });
}
async function loadProfile(page, username, serviceId) {
  await page.goto(`${BASE}/bg/p/${username}?service=${serviceId}`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".slot-chip--available", { timeout: 20000 });
}
async function bookFirstSlot(page) {
  await page.locator(".slot-chip--available").first().click();
  const dlg = page.locator("dialog[open]");
  await dlg.waitFor({ state: "visible", timeout: 10000 });
  await dlg.getByRole("button", { name: "Запази" }).click();
  await page.waitForURL(/[?&](bookingError|booked)=/, { timeout: 20000 });
  const u = new URL(page.url());
  return u.searchParams.get("bookingError") ?? (u.searchParams.get("booked") ? "booked" : "unknown");
}

(async () => {
  let browser;
  try {
    console.log("=== Setup ===");
    const admin = await mk("client", "PC Admin");
    await db.from("profiles").update({ role: "admin" }).eq("id", admin.id);
    const client = await mk("client", "PC Client");
    const prac = await mk("practitioner", "PC Prac");
    for (let i = 0; i < 20; i++) {
      if ((await db.from("practitioner_profiles").select("id").eq("id", prac.id).maybeSingle()).data) break;
      await new Promise((r) => setTimeout(r, 200));
    }
    const username = `pcprac${stamp}`;
    await db.from("practitioner_profiles").update({
      username, timezone: "Europe/Sofia", avatar_url: "https://example.com/a.png",
      bio: "bio", headline: "headline", location: "Sofia", specialties: ["coaching"],
    }).eq("id", prac.id);
    await db.from("practitioner_availability").insert([1, 2, 3, 4, 5, 6, 7].map((d) => ({ practitioner_id: prac.id, day_of_week: d, start_time: "00:00:00", end_time: "23:45:00" })));
    const { data: svc } = await db.from("services").insert({ practitioner_id: prac.id, name: "PC Svc", duration_minutes: 30, price_cents: 5000, currency: "EUR", is_active: true, delivery_type: "online", delivery_info: "https://example.com/m" }).select("id").single();

    // ── A) derivation matrix ──────────────────────────────────────────
    console.log("\n=== A) derivation matrix ===");
    await setMod(prac.id, "active");
    check("active → bookable", (await bookable(prac.id)) === true);
    check("active → searchable", (await searchable(prac.id)) === true);
    await setMod(prac.id, "hidden");
    check("hidden → STILL bookable (by URL)", (await bookable(prac.id)) === true);
    check("hidden → NOT searchable", (await searchable(prac.id)) === false);
    await setMod(prac.id, "bookings_frozen");
    check("bookings_frozen → NOT bookable", (await bookable(prac.id)) === false);
    await setMod(prac.id, "suspended");
    check("suspended → NOT bookable", (await bookable(prac.id)) === false);
    check("suspended → NOT searchable", (await searchable(prac.id)) === false);
    await setMod(prac.id, "active");

    browser = await chromium.launch();
    const clientCtx = await browser.newContext();
    const clientPage = await clientCtx.newPage();
    await login(clientPage, client.email);

    // ── B) live enforcement at the booking action ─────────────────────
    console.log("\n=== B) booking-action enforcement ===");
    // Load while active (slots render), then freeze mid-session: the ACTION must
    // still refuse (defense in depth beyond the profile hiding slots).
    await loadProfile(clientPage, username, svc.id);
    await setMod(prac.id, "bookings_frozen");
    check("frozen mid-session → booking refused at the action", (await bookFirstSlot(clientPage)) === "practitionerUnavailable");
    // Hidden: still bookable by URL — a fresh load shows slots and a booking goes through.
    await setMod(prac.id, "hidden");
    await loadProfile(clientPage, username, svc.id);
    check("hidden → still bookable by direct URL", (await bookFirstSlot(clientPage)) === "booked");
    await setMod(prac.id, "active");

    // ── C) admin control UI (apply freeze with a reason) ──────────────
    console.log("\n=== C) admin control UI ===");
    const adminCtx = await browser.newContext();
    const adminPage = await adminCtx.newPage();
    await login(adminPage, admin.email);
    await adminPage.goto(`${BASE}/bg/admin/practitioners?q=${username}`, { waitUntil: "networkidle" });
    let opened = false;
    for (let i = 0; i < 4 && !opened; i++) {
      await adminPage.getByRole("button", { name: "Спри записванията" }).first().click();
      try { await adminPage.locator("dialog[open]").waitFor({ state: "visible", timeout: 3000 }); opened = true; } catch { /* hydration race */ }
    }
    const dlg = adminPage.locator("dialog[open]");
    await dlg.locator('textarea[name="reason"]').fill("E2E: unresponsive, investigating");
    await dlg.getByRole("button", { name: "Приложи" }).click();
    // poll DB for the applied state
    let applied = null;
    for (let i = 0; i < 20; i++) {
      applied = (await db.from("practitioner_profiles").select("moderation_status, moderation_reason").eq("id", prac.id).single()).data;
      if (applied?.moderation_status === "bookings_frozen") break;
      await new Promise((r) => setTimeout(r, 300));
    }
    check("admin UI applied freeze", applied?.moderation_status === "bookings_frozen", applied?.moderation_status);
    check("reason stored (shown to practitioner)", (applied?.moderation_reason ?? "").includes("unresponsive"));
    const audit = (await db.from("admin_audit_log").select("action, new_value").eq("action", "practitioner.moderation:bookings_frozen").order("created_at", { ascending: false }).limit(1)).data?.[0];
    check("audit row written", !!audit && (audit.new_value ?? "").includes("unresponsive"));

    // ── D) practitioner notice ────────────────────────────────────────
    console.log("\n=== D) practitioner notice ===");
    const pracCtx = await browser.newContext();
    const pracPage = await pracCtx.newPage();
    await login(pracPage, prac.email);
    await pracPage.goto(`${BASE}/bg/practitioner-dashboard`, { waitUntil: "networkidle" });
    check("dashboard shows the frozen-bookings banner", (await pracPage.getByText("Новите записвания са спрени").count()) > 0);
  } catch (err) {
    console.error("\n!!! aborted:", err.message);
    failures++;
  } finally {
    if (browser) await browser.close();
    for (const id of created) await db.auth.admin.deleteUser(id).catch(() => {});
    console.log(`\ncleaned up ${created.length} users`);
    console.log(failures === 0 ? "ALL PASS ✓" : `${failures} FAILURE(S) ✗`);
    process.exit(failures === 0 ? 0 : 1);
  }
})();
