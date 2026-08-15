// Live E2E: prove each admin kill switch actually KILLS, through the real UI.
// Logs in as admin, toggles each switch via the confirm-dialog UI (which also
// invalidates the flag cache immediately), then — as a real client / signup —
// confirms the guarded action is genuinely refused, then toggles back and
// confirms normal behaviour returns.
//
// Run (dev server must be up on :3000):
//   node --env-file=.env.local <thisfile>
import { createClient } from "@supabase/supabase-js";
import { chromium } from "playwright";

const BASE = "http://localhost:3000";
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const db = createClient(url, process.env.SUPABASE_SECRET_KEY);
const PW = "twelvecharspw1";
const stamp = Date.now();

let failures = 0;
const results = [];
function check(label, cond, detail) {
  const ok = !!cond;
  if (!ok) failures++;
  results.push(`${ok ? "PASS" : "FAIL"} — ${label}${detail !== undefined ? `  (${detail})` : ""}`);
  console.log(results[results.length - 1]);
}

const created = []; // user ids to clean up
const flagKeys = ["newBookings", "video", "checkout", "clientRegistration", "practitionerRegistration"];

async function makeUser(role, name, meta = {}) {
  const email = `e2e-${role}-${stamp}-${Math.random().toString(36).slice(2, 6)}@example.com`;
  const { data, error } = await db.auth.admin.createUser({
    email,
    password: PW,
    email_confirm: true,
    user_metadata: { role, display_name: name },
  });
  if (error) throw new Error(`createUser ${role}: ${error.message}`);
  created.push(data.user.id);
  await new Promise((r) => setTimeout(r, 400)); // let handle_new_user finish
  return { id: data.user.id, email, ...meta };
}

async function setupPractitioner(tag, { commission } = {}) {
  const p = await makeUser("practitioner", `E2E Prac ${tag}`);
  // Wait for handle_new_user to create the practitioner_profiles row before we
  // update it — otherwise the update hits 0 rows (no error) and the profile
  // stays incomplete, so is_practitioner_bookable() is false and the public
  // profile hides services + slots entirely.
  for (let i = 0; i < 20; i++) {
    const { data } = await db.from("practitioner_profiles").select("id").eq("id", p.id).maybeSingle();
    if (data) break;
    await new Promise((r) => setTimeout(r, 200));
  }
  const username = `e2eprac${tag}${stamp}`.toLowerCase();
  // Full profile so is_practitioner_bookable() is true (avatar/bio/headline/
  // location/specialties all required), else the profile hides services+slots.
  const ppUpdate = {
    username,
    timezone: "Europe/Sofia",
    avatar_url: "https://example.com/avatar.png",
    bio: "E2E test bio.",
    headline: "E2E headline",
    location: "Sofia",
    specialties: ["coaching"],
  };
  if (commission) {
    ppUpdate.billing_model = "commission";
    ppUpdate.stripe_connected_account_id = `acct_e2e_${tag}${stamp}`;
    ppUpdate.stripe_connect_transfers_active = true;
  }
  const { error: ppErr } = await db.from("practitioner_profiles").update(ppUpdate).eq("id", p.id);
  if (ppErr) throw new Error(`practitioner_profiles update: ${ppErr.message}`);
  const rules = [1, 2, 3, 4, 5, 6, 7].map((day_of_week) => ({
    practitioner_id: p.id,
    day_of_week,
    start_time: "00:00:00",
    end_time: "23:45:00",
  }));
  const { error: avErr } = await db.from("practitioner_availability").insert(rules);
  if (avErr) throw new Error(`availability insert: ${avErr.message}`);
  const { data: svc, error: svcErr } = await db
    .from("services")
    .insert({
      practitioner_id: p.id,
      name: `E2E Online Svc ${tag}`,
      duration_minutes: 30,
      price_cents: 5000,
      currency: "EUR",
      is_active: true,
      delivery_type: "online",
      delivery_info: "https://example.com/meeting",
    })
    .select("id")
    .single();
  if (svcErr) throw new Error(`service insert: ${svcErr.message}`);
  const { data: bookable } = await db.rpc("is_practitioner_bookable", { target_practitioner_id: p.id });
  if (!bookable) throw new Error(`practitioner ${tag} did not become bookable after setup`);
  return { ...p, username, serviceId: svc.id };
}

async function login(page, email) {
  await page.goto(`${BASE}/bg/login`, { waitUntil: "domcontentloaded" });
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', PW);
  await page.click('button[type="submit"]');
  await page.waitForURL((u) => !u.pathname.includes("/login"), { timeout: 30000 });
}

// Toggle a switch through the admin UI: click the switch, confirm in the dialog,
// wait for the committed state to flip. desiredOn=false -> "Изключи", true -> "Включи".
async function adminToggle(page, ariaName, desiredOn) {
  const sw = page.getByRole("switch", { name: ariaName });
  const dlg = page.locator("dialog[open]");
  // Retry opening the dialog — the first toggle can race FlagToggle's hydration
  // (onClick not yet attached, so the click no-ops).
  let opened = false;
  for (let i = 0; i < 4 && !opened; i++) {
    await sw.click();
    try {
      await dlg.waitFor({ state: "visible", timeout: 3000 });
      opened = true;
    } catch {
      /* not hydrated yet — click again */
    }
  }
  if (!opened) throw new Error(`toggle dialog for "${ariaName}" never opened`);
  await dlg.getByRole("button", { name: desiredOn ? "Включи" : "Изключи" }).click();
  await page.waitForSelector(`[role="switch"][aria-label="${ariaName}"][aria-checked="${desiredOn}"]`, { timeout: 15000 });
}

// Attempt a booking as the client; return the resulting outcome code from the URL.
async function attemptBooking(page, username, serviceId) {
  await page.goto(`${BASE}/bg/p/${username}?service=${serviceId}`, { waitUntil: "domcontentloaded" });
  try {
    await page.waitForSelector(".slot-chip--available", { timeout: 20000 });
  } catch (e) {
    // On failure, dump what the profile actually rendered — the common causes
    // are a non-bookable practitioner (services/slots hidden) or a 404 (bad
    // username case), both of which show plainly in the body text.
    const d = await page.evaluate(() => ({
      url: location.href,
      chips: document.querySelectorAll(".slot-chip").length,
      body: (document.body.innerText || "").replace(/\s+/g, " ").slice(0, 300),
    }));
    console.log("  [attemptBooking diag]", JSON.stringify(d));
    throw e;
  }
  await page.locator(".slot-chip--available").first().click();
  const dlg = page.locator("dialog[open]");
  await dlg.waitFor({ state: "visible", timeout: 10000 });
  await dlg.getByRole("button", { name: "Запази" }).click();
  await page.waitForURL(/[?&](bookingError|booked)=/, { timeout: 20000 });
  const u = new URL(page.url());
  return u.searchParams.get("bookingError") ?? (u.searchParams.get("booked") ? "booked" : "unknown");
}

const REG_CLOSED = "Регистрацията е временно затворена";
async function attemptSignup(context, role) {
  const page = await context.newPage();
  await page.goto(`${BASE}/bg/signup`, { waitUntil: "domcontentloaded" });
  await page.fill('input[name="displayName"]', `E2E Signup ${role}`);
  await page.fill('input[name="email"]', `e2e-signup-${role}-${stamp}-${Math.random().toString(36).slice(2, 6)}@example.com`);
  await page.fill('input[name="password"]', PW);
  await page.check(`input[name="role"][value="${role}"]`);
  await page.click('button[type="submit"]');
  await page.waitForTimeout(2500); // let the server action resolve
  const blocked = await page.getByText(REG_CLOSED).count();
  await page.close();
  return blocked > 0;
}

(async () => {
  let browser;
  try {
    console.log("=== Setup (service role) ===");
    const admin = await makeUser("client", "E2E Admin");
    const { error: roleErr } = await db.from("profiles").update({ role: "admin" }).eq("id", admin.id);
    if (roleErr) throw new Error(`admin role: ${roleErr.message}`);
    const client = await makeUser("client", "E2E Client");
    const pracSW = await setupPractitioner("SW", { commission: false }); // software_provider -> clean success
    const pracC = await setupPractitioner("C", { commission: true }); // commission + fake stripe -> reaches checkout gate
    console.log(`admin=${admin.email}\nclient=${client.email}\npracSW=@${pracSW.username}  pracC=@${pracC.username}`);

    browser = await chromium.launch();
    const adminCtx = await browser.newContext();
    const clientCtx = await browser.newContext();
    const anonCtx = await browser.newContext(); // no session — /signup shows the form
    const adminPage = await adminCtx.newPage();
    const clientPage = await clientCtx.newPage();

    console.log("\n=== Login ===");
    await login(adminPage, admin.email);
    await adminPage.goto(`${BASE}/bg/admin`, { waitUntil: "networkidle" });
    check("admin reaches /admin Controls", (await adminPage.getByRole("switch", { name: "Нови записвания" }).count()) === 1);
    await login(clientPage, client.email);

    // ── 1. NEW BOOKINGS ──────────────────────────────────────────────
    console.log("\n=== New bookings switch ===");
    await adminToggle(adminPage, "Нови записвания", false);
    check("booking refused when new bookings OFF", (await attemptBooking(clientPage, pracSW.username, pracSW.serviceId)) === "bookingsPaused");
    await adminToggle(adminPage, "Нови записвания", true);
    check("booking succeeds when new bookings back ON", (await attemptBooking(clientPage, pracSW.username, pracSW.serviceId)) === "booked");

    // ── 2. VIDEO ─────────────────────────────────────────────────────
    console.log("\n=== Online video switch ===");
    await adminToggle(adminPage, "Онлайн видео сесии", false);
    check("online booking refused when video OFF", (await attemptBooking(clientPage, pracSW.username, pracSW.serviceId)) === "videoUnavailable");
    await adminToggle(adminPage, "Онлайн видео сесии", true);
    check("online booking succeeds when video back ON", (await attemptBooking(clientPage, pracSW.username, pracSW.serviceId)) === "booked");

    // ── 3. CHECKOUT (commission practitioner) ────────────────────────
    console.log("\n=== Payments (checkout) switch ===");
    await adminToggle(adminPage, "Плащания (каса)", false);
    check("checkout refused when payments OFF", (await attemptBooking(clientPage, pracC.username, pracC.serviceId)) === "checkoutPaused");
    await adminToggle(adminPage, "Плащания (каса)", true);
    const checkoutOn = await attemptBooking(clientPage, pracC.username, pracC.serviceId);
    check("checkout gate opens when payments back ON (reaches Stripe, no longer checkoutPaused)", checkoutOn !== "checkoutPaused", `got ${checkoutOn}`);

    // ── 4. CLIENT REGISTRATION ───────────────────────────────────────
    console.log("\n=== Client registration switch ===");
    await adminToggle(adminPage, "Регистрация на клиенти", false);
    check("client signup blocked when client registration OFF", (await attemptSignup(anonCtx, "client")) === true);
    await adminToggle(adminPage, "Регистрация на клиенти", true);
    check("client signup no longer blocked when back ON", (await attemptSignup(anonCtx, "client")) === false);

    // ── 5. PRACTITIONER REGISTRATION ─────────────────────────────────
    console.log("\n=== Practitioner registration switch ===");
    await adminToggle(adminPage, "Регистрация на специалисти", false);
    check("practitioner signup blocked when practitioner registration OFF", (await attemptSignup(anonCtx, "practitioner")) === true);
    await adminToggle(adminPage, "Регистрация на специалисти", true);
    check("practitioner signup no longer blocked when back ON", (await attemptSignup(anonCtx, "practitioner")) === false);
  } catch (err) {
    console.error("\n!!! E2E aborted:", err.message);
    failures++;
  } finally {
    if (browser) await browser.close();
    console.log("\n=== Cleanup ===");
    for (const id of created) {
      await db.auth.admin.deleteUser(id).catch(() => {});
    }
    await db.from("feature_flags").delete().in("key", flagKeys);
    console.log(`deleted ${created.length} users + reset ${flagKeys.length} flag overrides`);
    console.log(`\n${failures === 0 ? "ALL PASS ✓" : `${failures} FAILURE(S) ✗`}`);
    process.exit(failures === 0 ? 0 : 1);
  }
})();
