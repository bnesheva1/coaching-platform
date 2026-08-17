// Verify the immediate-availability rework: fit decoupled from working hours,
// per-service duration fit, marker gated on bookability, and the toggle auto-off
// with the right reason. Flag is on via env (IMMEDIATE_BOOKING_ENABLED) in the
// running dev server. Run: node --env-file=.env.local scripts/verify-immediate-fit-rework.mjs
import { createClient } from "@supabase/supabase-js";
import { chromium } from "playwright";

const BASE = "http://localhost:3000";
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SECRET_KEY);
const PW = "twelvecharspw1";
const stamp = Date.now();
let failures = 0;
const created = [];
const check = (l, c, d) => { if (!c) failures++; console.log(`${c ? "PASS" : "FAIL"} — ${l}${d !== undefined ? `  (${d})` : ""}`); };
const iso = (msFromNow) => new Date(Date.now() + msFromNow).toISOString();

async function mk(role, name) {
  const email = `fit-${role}-${stamp}-${Math.random().toString(36).slice(2, 5)}@example.com`;
  const { data, error } = await db.auth.admin.createUser({ email, password: PW, email_confirm: true, user_metadata: { role, display_name: name } });
  if (error) throw error;
  created.push(data.user.id);
  await new Promise((r) => setTimeout(r, 400));
  return { id: data.user.id, email };
}
async function present(pid, available) {
  await db.from("immediate_presence").upsert(
    { practitioner_id: pid, available_now: available, last_heartbeat_at: available ? new Date().toISOString() : null, updated_at: new Date().toISOString() },
    { onConflict: "practitioner_id" },
  );
}
// day_of_week (Mon=1..Sun=7) that is NOT today in Sofia — for the "outside hours" case.
function notTodaySofia() {
  const short = new Intl.DateTimeFormat("en-US", { timeZone: "Europe/Sofia", weekday: "short" }).format(new Date());
  const map = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };
  return (map[short] % 7) + 1; // tomorrow
}
async function setupPractitioner(prac, uname, availabilityRows, services) {
  for (let i = 0; i < 20; i++) { if ((await db.from("practitioner_profiles").select("id").eq("id", prac.id).maybeSingle()).data) break; await new Promise((r) => setTimeout(r, 200)); }
  await db.from("practitioner_profiles").update({ username: uname, timezone: "Europe/Sofia", avatar_url: "x", bio: "b", headline: "h", location: "Sofia", specialties: ["coaching"], billing_model: "software_provider" }).eq("id", prac.id);
  await db.from("practitioner_availability").insert(availabilityRows.map((r) => ({ practitioner_id: prac.id, ...r })));
  const ids = {};
  for (const s of services) {
    const { data } = await db.from("services").insert({ practitioner_id: prac.id, name: s.name, duration_minutes: s.duration, price_cents: 5000, currency: "EUR", is_active: s.active ?? true, delivery_type: "online", delivery_info: "x" }).select("id").single();
    ids[s.name] = data.id;
  }
  return ids;
}
const fullWeek = [1, 2, 3, 4, 5, 6, 7].map((d) => ({ day_of_week: d, start_time: "00:00:00", end_time: "23:45:00" }));

(async () => {
  let browser;
  try {
    console.log("=== Setup ===");
    const client = await mk("client", `Fit Client ${stamp}`);
    // P1: availability ONLY on a non-today day → hours never cover now.
    const p1 = await mk("practitioner", "P1 OutsideHours");
    await setupPractitioner(p1, `p1_${stamp}`, [{ day_of_week: notTodaySofia(), start_time: "10:00:00", end_time: "11:00:00" }], [{ name: "Short30", duration: 30 }]);
    // P2: two services 30 + 120, full-week hours, a booking 45 min out.
    const p2 = await mk("practitioner", "P2 PerService");
    const p2svc = await setupPractitioner(p2, `p2_${stamp}`, fullWeek, [{ name: "S30", duration: 30 }, { name: "S120", duration: 120 }]);
    await db.from("bookings").insert({ practitioner_id: p2.id, client_id: client.id, service_id: p2svc["S30"], start_utc: iso(45 * 60000), end_utc: iso(75 * 60000), delivery_type: "online", service_name: "sched", price_cents: 5000, currency: "EUR" });
    // P3: one 30-min service, a booking 20 min out → nothing fits.
    const p3 = await mk("practitioner", "P3 TooSoon");
    const p3svc = await setupPractitioner(p3, `p3_${stamp}`, fullWeek, [{ name: "Only30", duration: 30 }]);
    await db.from("bookings").insert({ practitioner_id: p3.id, client_id: client.id, service_id: p3svc["Only30"], start_utc: iso(20 * 60000), end_utc: iso(50 * 60000), delivery_type: "online", service_name: "sched", price_cents: 5000, currency: "EUR" });
    // P4: bookable at first (no conflict) — a conflict is inserted mid-test so the
    // auto-off happens on a LATER tick (the real staleness scenario), avoiding the
    // dev-only StrictMode double-mount race on the very first tick.
    const p4 = await mk("practitioner", "P4 Stale");
    const p4svc = await setupPractitioner(p4, `p4_${stamp}`, fullWeek, [{ name: "Only30", duration: 30 }]);

    await Promise.all([present(p1.id, true), present(p2.id, true), present(p3.id, true)]);

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
    const bookNow = () => page.getByRole("button", { name: "Резервирай сега" });

    await loginAs(client.email);

    console.log("\n=== 1. Fit decoupled from working hours ===");
    await page.goto(`${BASE}/bg/p/p1_${stamp}`, { waitUntil: "networkidle" });
    check("outside published hours, still bookable now (Book-now shows)", await bookNow().first().isVisible().catch(() => false));
    check("marker shows when bookable", await page.getByText("На разположение сега").first().isVisible().catch(() => false));

    console.log("\n=== 2. Per-service duration fit (30 fits, 120 doesn't, 45m to next) ===");
    await page.goto(`${BASE}/bg/p/p2_${stamp}`, { waitUntil: "networkidle" });
    await page.waitForTimeout(500);
    const count = await bookNow().count();
    check("exactly one service offers Book-now (only the 30-min fits)", count === 1, `${count} buttons`);

    console.log("\n=== 3. Nothing fits (next session 20m) → no marker, no Book-now ===");
    await page.goto(`${BASE}/bg/p/p3_${stamp}`, { waitUntil: "networkidle" });
    check("no Book-now when nothing fits", !(await bookNow().first().isVisible().catch(() => false)));
    check("marker gated on bookability — absent when nothing fits", !(await page.getByText("На разположение сега").first().isVisible().catch(() => false)));

    console.log("\n=== 4. Staleness: auto-off + reason on a later tick (§4) ===");
    await loginAs(p4.email);
    await present(p4.id, true); // bookable now (no conflict) → widget comes up available
    await page.goto(`${BASE}/bg/practitioner-dashboard`, { waitUntil: "networkidle" });
    await page.waitForTimeout(2500); // let the initial (StrictMode) mount settle, still available
    check("available at load (bookable, no conflict)", (await db.rpc("is_practitioner_available_now", { target: p4.id })).data === true);
    // A scheduled session now appears 20 min out → the next tick must auto-off + explain.
    await db.from("bookings").insert({ practitioner_id: p4.id, client_id: client.id, service_id: p4svc["Only30"], start_utc: iso(20 * 60000), end_utc: iso(50 * 60000), delivery_type: "online", service_name: "sched", price_cents: 5000, currency: "EUR" });
    await page.waitForTimeout(12000); // wait out the next 10s tick on the live instance
    check("stale availability auto-switched OFF (presence false)", (await db.rpc("is_practitioner_available_now", { target: p4.id })).data === false);
    check("block modal shown with the 'next session too soon' reason", await page.getByText("Най-кратката ви услуга").first().isVisible().catch(() => false));
    check("modal names when they can go available (free-at line)", await page.getByText("Ще можете да се обявите").first().isVisible().catch(() => false));
  } catch (err) {
    console.error("\n!!! aborted:", err.stack || err.message);
    failures++;
  } finally {
    if (browser) await browser.close();
    for (const id of created) {
      await db.from("immediate_holds").delete().eq("practitioner_id", id);
      await db.from("immediate_requests").delete().or(`client_id.eq.${id},practitioner_id.eq.${id}`);
      await db.from("bookings").delete().eq("practitioner_id", id);
      await db.from("immediate_presence").delete().eq("practitioner_id", id);
    }
    for (const id of created) await db.auth.admin.deleteUser(id).catch(() => {});
    console.log(`\ncleaned up ${created.length} users`);
    console.log(failures === 0 ? "ALL PASS ✓" : `${failures} FAIL ✗`);
    process.exit(failures === 0 ? 0 : 1);
  }
})();
