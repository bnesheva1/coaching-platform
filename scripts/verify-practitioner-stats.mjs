// Practitioner stats dashboard — verification. Seeds a practitioner with bookings
// across statuses + payments + reviews + view counters, checks the computed
// numbers + funnel drop-off on the practitioner's own page and the admin page,
// the privacy-safe counter (increment, session-dedup, owner-exclusion), the empty
// state, and that a practitioner can't open another's admin stats.
// Requires migration 20260818120000 applied.
// Run: node --env-file=.env.local scripts/verify-practitioner-stats.mjs
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
  const email = `st-${role}-${stamp}-${Math.random().toString(36).slice(2, 5)}@example.com`;
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
  const { data: svc } = await db.from("services").insert({ practitioner_id: prac.id, name: "Svc", duration_minutes: 30, price_cents: 6000, currency: "EUR", is_active: true, delivery_type: "online", delivery_info: "x" }).select("id").single();
  return svc.id;
}
const monthPeriod = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Sofia", year: "numeric", month: "2-digit" }).format(new Date()) + "-01";
const counterCount = async (pid, metric, bucket, period) =>
  (await db.from("practitioner_view_counters").select("count").eq("practitioner_id", pid).eq("metric", metric).eq("bucket", bucket).eq("period_start", period).maybeSingle()).data?.count ?? 0;
const daysAgo = (n) => new Date(Date.now() - n * 864e5).toISOString();

(async () => {
  let browser;
  try {
    console.log("=== Setup ===");
    const P = await mk("practitioner", `Prac ${stamp}`);
    const Q = await mk("practitioner", `Other ${stamp}`);
    const E = await mk("practitioner", `Empty ${stamp}`);
    const admin = await mk("admin", `Admin ${stamp}`);
    const c1 = await mk("client", `C1 ${stamp}`);
    const c2 = await mk("client", `C2 ${stamp}`);
    const c3 = await mk("client", `C3 ${stamp}`);
    const svcId = await setupPractitioner(P, `pst${stamp}`);
    await setupPractitioner(Q, `qst${stamp}`);
    await setupPractitioner(E, `est${stamp}`);
    // The signup trigger won't grant 'admin' from metadata — set it directly.
    await db.from("profiles").update({ role: "admin" }).eq("id", admin.id);

    // Bookings this month: 3 completed (c1×2 = repeat, c2×1), 1 cancelled_by_client
    // (c3), 1 cancelled_by_practitioner (c1). → completed 3, cancelledClient 1,
    // cancelledPract 1, repeat clients = 1 (c1 has 3). booked=5, completed=3.
    // Distinct time slots per booking — a practitioner's bookings can't overlap
    // (GiST exclusion constraint), even across statuses in this seed.
    const slot = (h) => ({ s: new Date(Date.now() - 864e5 + h * 36e5).toISOString(), e: new Date(Date.now() - 864e5 + h * 36e5 + 18e5).toISOString() });
    const b = (clientId, status, h) => { const t = slot(h); return { practitioner_id: P.id, client_id: clientId, service_id: svcId, start_utc: t.s, end_utc: t.e, delivery_type: "online", service_name: "Svc", price_cents: 6000, currency: "EUR", status }; };
    const { data: completed, error: cErr } = await db.from("bookings").insert([b(c1.id, "completed", 0), b(c1.id, "completed", 1), b(c2.id, "completed", 2)]).select("id");
    if (cErr) throw new Error("completed insert failed: " + cErr.message);
    const { error: xErr } = await db.from("bookings").insert([b(c3.id, "cancelled_by_client", 3), b(c1.id, "cancelled_by_practitioner", 4)]);
    if (xErr) throw new Error("cancelled insert failed: " + xErr.message);
    // Payments: 3 succeeded (€60 each, €9 commission) + 1 refunded (€60). Gross
    // €180, net €153.
    await db.from("payments").insert(completed.map((bk, i) => ({ booking_id: bk.id, stripe_checkout_session_id: `cs_${stamp}_${i}`, amount_cents: 6000, commission_cents: 900, currency: "EUR", status: "succeeded" })));
    await db.from("payments").insert({ booking_id: null, stripe_checkout_session_id: `cs_${stamp}_ref`, amount_cents: 6000, commission_cents: 900, currency: "EUR", status: "refunded" });
    // Reviews: ratings 5,4,5 → avg 4.67, count 3 (bg formats as 4,67).
    await db.from("reviews").insert(completed.map((bk, i) => ({ booking_id: bk.id, practitioner_id: P.id, rating: [5, 4, 5][i], review_text: "ok" })));
    // Seeded counters: 137 profile views, 11 schedule opens this month.
    await db.from("practitioner_view_counters").insert([
      { practitioner_id: P.id, metric: "profile_viewed", bucket: "month", period_start: monthPeriod, count: 137 },
      { practitioner_id: P.id, metric: "schedule_opened", bucket: "month", period_start: monthPeriod, count: 11 },
    ]);

    browser = await chromium.launch();
    async function login(email) {
      const ctx = await browser.newContext();
      const page = await ctx.newPage();
      page.on("pageerror", (e) => console.log("  [pageerror]", e.message.slice(0, 140)));
      await page.goto(`${BASE}/bg/login`, { waitUntil: "domcontentloaded" });
      await page.fill('input[name="email"]', email);
      await page.fill('input[name="password"]', PW);
      await page.click('button[type="submit"]');
      await page.waitForURL((u) => !u.pathname.includes("/login"), { timeout: 30000 });
      return { ctx, page };
    }
    const textVisible = (page, s) => page.getByText(s, { exact: false }).first().isVisible().catch(() => false);

    console.log("\n=== 1. Practitioner's own stats page (seeded numbers) ===");
    {
      const { ctx, page } = await login(P.email);
      await page.goto(`${BASE}/bg/practitioner-dashboard/stats`, { waitUntil: "networkidle" });
      check("funnel shows seeded profile views (137)", await textVisible(page, "137"));
      check("funnel shows seeded schedule opens (11)", await textVisible(page, "11"));
      check("drop-off line spelled out (opened→booked)", await textVisible(page, "отвориха графика ви"));
      check("drop-off percentage shown (11 opened, 5 booked = 45%)", await textVisible(page, "45%"));
      check("reviews average computed (4,67)", await textVisible(page, "4,67"));
      // Home summary + see-all link.
      await page.goto(`${BASE}/bg/practitioner-dashboard`, { waitUntil: "networkidle" });
      check("home summary shows the funnel + see-all link", (await textVisible(page, "137")) && (await textVisible(page, "Виж цялата статистика")));
      await ctx.close();
    }

    console.log("\n=== 2. Admin can view any practitioner's stats ===");
    {
      const { ctx, page } = await login(admin.email);
      await page.goto(`${BASE}/bg/admin/practitioners/${P.id}/stats`, { waitUntil: "networkidle" });
      check("admin sees the practitioner's funnel (137)", await textVisible(page, "137"));
      check("admin sees the reviews average (4,67)", await textVisible(page, "4,67"));
      await ctx.close();
    }

    console.log("\n=== 3. A practitioner cannot open another's admin stats ===");
    {
      const { ctx, page } = await login(Q.email);
      const resp = await page.goto(`${BASE}/bg/admin/practitioners/${P.id}/stats`, { waitUntil: "domcontentloaded" });
      check("non-admin blocked from admin stats (not 200, no data)", resp.status() !== 200 && !(await textVisible(page, "137")), `status ${resp.status()}`);
      await ctx.close();
    }

    console.log("\n=== 4. Empty state for a new practitioner ===");
    {
      const { ctx, page } = await login(E.email);
      await page.goto(`${BASE}/bg/practitioner-dashboard/stats`, { waitUntil: "networkidle" });
      check("empty explainer shown (not zeros)", await textVisible(page, "Тук ще се появи вашата статистика"));
      await ctx.close();
    }

    console.log("\n=== 5. View counter: fire, session-dedup, owner-exclusion ===");
    const before = await counterCount(P.id, "profile_viewed", "month", monthPeriod);
    {
      // Guest, fresh context (empty sessionStorage) → one profile view fires.
      const ctx = await browser.newContext();
      const page = await ctx.newPage();
      await page.goto(`${BASE}/bg/p/pst${stamp}`, { waitUntil: "networkidle" });
      await page.waitForTimeout(1500);
      const afterOne = await counterCount(P.id, "profile_viewed", "month", monthPeriod);
      check("guest profile view increments the counter", afterOne === before + 1, `${before} → ${afterOne}`);
      // Same session again → deduped, no further increment.
      await page.goto(`${BASE}/bg/p/pst${stamp}`, { waitUntil: "networkidle" });
      await page.waitForTimeout(1500);
      check("second view in the same session is deduped", (await counterCount(P.id, "profile_viewed", "month", monthPeriod)) === before + 1);
      await ctx.close();
    }
    // week row exists (any period_start)
    const weekRows = (await db.from("practitioner_view_counters").select("count").eq("practitioner_id", P.id).eq("metric", "profile_viewed").eq("bucket", "week")).data ?? [];
    check("week bucket populated too", weekRows.length === 1 && weekRows[0].count === 1, JSON.stringify(weekRows));

    {
      // Schedule opened: guest expands availability.
      const openedBefore = await counterCount(P.id, "schedule_opened", "month", monthPeriod);
      const ctx = await browser.newContext();
      const page = await ctx.newPage();
      await page.goto(`${BASE}/bg/p/pst${stamp}`, { waitUntil: "networkidle" });
      await page.getByRole("button", { name: "Виж свободни часове" }).first().click().catch(() => {});
      await page.waitForTimeout(1500);
      check("opening the schedule increments schedule_opened", (await counterCount(P.id, "schedule_opened", "month", monthPeriod)) === openedBefore + 1);
      await ctx.close();
    }

    {
      // Owner viewing own profile is NOT counted.
      const ownerBefore = await counterCount(P.id, "profile_viewed", "month", monthPeriod);
      const { ctx, page } = await login(P.email);
      await page.goto(`${BASE}/bg/p/pst${stamp}`, { waitUntil: "networkidle" });
      await page.waitForTimeout(1500);
      check("practitioner viewing own profile is NOT counted", (await counterCount(P.id, "profile_viewed", "month", monthPeriod)) === ownerBefore);
      await ctx.close();
    }
  } catch (err) {
    console.error("\n!!! aborted:", err.stack || err.message);
    failures++;
  } finally {
    if (browser) await browser.close();
    for (const id of created) {
      await db.from("practitioner_view_counters").delete().eq("practitioner_id", id);
      await db.from("reviews").delete().eq("practitioner_id", id);
      await db.from("bookings").delete().eq("practitioner_id", id);
      await db.from("bookings").delete().eq("client_id", id);
    }
    // payments cascade from bookings (on delete cascade), plus the orphan refund:
    await db.from("payments").delete().like("stripe_checkout_session_id", `cs_${stamp}_%`);
    for (const id of created) await db.auth.admin.deleteUser(id).catch(() => {});
    console.log(`\ncleaned up ${created.length} users`);
    console.log(failures === 0 ? "ALL PASS ✓" : `${failures} FAIL ✗`);
    process.exit(failures === 0 ? 0 : 1);
  }
})();
