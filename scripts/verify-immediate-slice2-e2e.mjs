// Immediate booking slice 2 verification: discovery, payment hold, and the two
// confirm paths. DB-level checks (busy-times hold union, search available_now,
// count), the confirm branching driven through the real widget (commission →
// hold; software_provider → books immediately; fit re-checked at confirm for
// BOTH), then the client's confirmation page (booked → Join, cancelled → release).
// Run: node --env-file=.env.local scripts/verify-immediate-slice2-e2e.mjs
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
  const email = `s2-${role}-${stamp}-${Math.random().toString(36).slice(2, 5)}@example.com`;
  const { data, error } = await db.auth.admin.createUser({ email, password: PW, email_confirm: true, user_metadata: { role, display_name: name } });
  if (error) throw error;
  created.push(data.user.id);
  await new Promise((r) => setTimeout(r, 400));
  return { id: data.user.id, email };
}
const iso = (msFromNow) => new Date(Date.now() + msFromNow).toISOString();
const reqStatus = async (id) => (await db.from("immediate_requests").select("status").eq("id", id).single()).data?.status;
const isAvailable = async (id) => (await db.rpc("is_practitioner_available_now", { target: id })).data;
async function insertPending(clientId, pracId, serviceId, expiresMs = 120000) {
  const { data } = await db.from("immediate_requests").insert({ client_id: clientId, practitioner_id: pracId, service_id: serviceId, expires_at: iso(expiresMs) }).select("id").single();
  return data.id;
}
async function present(pracId, available) {
  await db.from("immediate_presence").upsert(
    { practitioner_id: pracId, available_now: available, last_heartbeat_at: available ? new Date().toISOString() : null, updated_at: new Date().toISOString() },
    { onConflict: "practitioner_id" },
  );
}
async function setupPractitioner(prac, billing, uname) {
  for (let i = 0; i < 20; i++) { if ((await db.from("practitioner_profiles").select("id").eq("id", prac.id).maybeSingle()).data) break; await new Promise((r) => setTimeout(r, 200)); }
  // A commission practitioner is only bookable (and thus sees the availability
  // widget rather than the activation checklist) once Stripe transfers are live.
  await db.from("practitioner_profiles").update({ username: uname, timezone: "UTC", avatar_url: "x", bio: "b", headline: "h", location: "Sofia", specialties: ["coaching"], billing_model: billing, stripe_connect_transfers_active: billing === "commission" }).eq("id", prac.id);
  // end_time must sit on the 15-minute grid (practitioner_availability_15_minute_grid).
  await db.from("practitioner_availability").insert([1, 2, 3, 4, 5, 6, 7].map((d) => ({ practitioner_id: prac.id, day_of_week: d, start_time: "00:00:00", end_time: "23:45:00" })));
  const { data: svc } = await db.from("services").insert({ practitioner_id: prac.id, name: "IM Svc", duration_minutes: 30, price_cents: 5000, currency: "EUR", is_active: true, delivery_type: "online", delivery_info: "x" }).select("id").single();
  return svc.id;
}

(async () => {
  let browser;
  try {
    console.log("=== Enable flag + settle cache ===");
    await db.from("feature_flags").upsert({ key: "immediateBooking", enabled: true, updated_at: new Date().toISOString() }, { onConflict: "key" });

    console.log("=== Setup ===");
    const client = await mk("client", `S2 Client ${stamp}`);
    const pracSw = await mk("practitioner", "S2 Sw");
    const pracComm = await mk("practitioner", "S2 Comm");
    const unameSw = `s2sw${stamp}`, unameComm = `s2comm${stamp}`;
    const svcSw = await setupPractitioner(pracSw, "software_provider", unameSw);
    const svcComm = await setupPractitioner(pracComm, "commission", unameComm);

    console.log("\n=== DB-level checks ===");
    // Busy-times unions an ACTIVE hold; ignores an expired one. The hold FK
    // references a real request (on delete cascade), so keep the request alive
    // until BOTH checks are done, then delete it (which cascade-removes the hold).
    const rqBusy = await insertPending(client.id, pracSw.id, svcSw);
    const { data: h } = await db.from("immediate_holds").insert({ practitioner_id: pracSw.id, request_id: rqBusy, start_utc: iso(10 * 60000), end_utc: iso(40 * 60000), expires_at: iso(5 * 60000) }).select("id").single();
    const busyActive = await db.rpc("get_practitioner_busy_times", { target_practitioner_id: pracSw.id, window_start: iso(0), window_end: iso(60 * 60000) });
    check("busy-times includes an active hold", (busyActive.data ?? []).length >= 1, `${(busyActive.data ?? []).length} rows`);
    await db.from("immediate_holds").update({ expires_at: iso(-60000) }).eq("id", h.id);
    const busyExpired = await db.rpc("get_practitioner_busy_times", { target_practitioner_id: pracSw.id, window_start: iso(0), window_end: iso(60 * 60000) });
    check("busy-times EXCLUDES an expired hold", (busyExpired.data ?? []).length === 0, `${(busyExpired.data ?? []).length} rows`);
    await db.from("immediate_requests").delete().eq("id", rqBusy); // cascade-removes the hold

    // search available_now + count, with pracSw available.
    await present(pracSw.id, true);
    const bookable = (await db.rpc("is_practitioner_bookable", { target_practitioner_id: pracSw.id })).data;
    check("software_provider practitioner is bookable (for discovery)", bookable === true, String(bookable));
    const searchAll = await db.rpc("search_practitioners", { specialty_keys: null, search_query: null, only_bookable: true, only_available_now: false });
    const swRow = (searchAll.data ?? []).find((r) => r.id === pracSw.id);
    check("search returns available_now=true for an available practitioner", swRow?.available_now === true, String(swRow?.available_now));
    const searchOnly = await db.rpc("search_practitioners", { specialty_keys: null, search_query: null, only_bookable: true, only_available_now: true });
    check("only_available_now filter includes the available one", (searchOnly.data ?? []).some((r) => r.id === pracSw.id));
    check("only_available_now filter EXCLUDES a not-available one", !(searchOnly.data ?? []).some((r) => r.id === pracComm.id));
    const cnt = (await db.rpc("count_available_now_practitioners")).data;
    check("count_available_now_practitioners ≥ 1", cnt >= 1, String(cnt));

    const waited = Date.now() - stamp;
    const remain = Math.max(0, 65000 - waited);
    console.log(`  waiting ${Math.round(remain / 1000)}s more for the flag cache…`);
    await new Promise((r) => setTimeout(r, remain));

    browser = await chromium.launch();
    const ctx = await browser.newContext();
    await ctx.grantPermissions(["notifications"], { origin: BASE });
    const page = await ctx.newPage();
    page.on("pageerror", (e) => console.log("  [pageerror]", e.message.slice(0, 160)));
    async function loginAs(email) {
      await ctx.clearCookies(); // switching users — drop the prior session first
      await page.goto(`${BASE}/bg/login`, { waitUntil: "domcontentloaded" });
      await page.fill('input[name="email"]', email);
      await page.fill('input[name="password"]', PW);
      await page.click('button[type="submit"]');
      await page.waitForURL((u) => !u.pathname.includes("/login"), { timeout: 30000 });
    }
    async function makeAvailableAndOpen(pracId) {
      await present(pracId, true);
      await page.goto(`${BASE}/bg/practitioner-dashboard`, { waitUntil: "networkidle" });
      await page.waitForTimeout(1500);
    }

    console.log("\n=== Discovery UI (client) ===");
    await present(pracSw.id, true);
    await loginAs(client.email);
    await page.goto(`${BASE}/bg/p/${unameSw}`, { waitUntil: "networkidle" });
    check("profile shows the Book-now button when available + fits", await page.getByRole("button", { name: "Резервирай сега" }).first().isVisible().catch(() => false));
    check("profile shows the available-now label", await page.getByText("На разположение сега").first().isVisible().catch(() => false));
    await page.goto(`${BASE}/bg/browse`, { waitUntil: "networkidle" });
    await page.waitForTimeout(800);
    check("browse shows the available-now filter toggle", await page.getByRole("button", { name: "На разположение сега" }).first().isVisible().catch(() => false));

    console.log("\n=== software_provider confirm → books immediately ===");
    const pSw = await insertPending(client.id, pracSw.id, svcSw);
    await loginAs(pracSw.email);
    await makeAvailableAndOpen(pracSw.id);
    await page.getByRole("button", { name: "Потвърди" }).first().waitFor({ timeout: 12000 });
    await page.getByRole("button", { name: "Потвърди" }).first().click();
    await page.waitForTimeout(2500);
    check("sw confirm → request 'booked'", (await reqStatus(pSw)) === "booked", await reqStatus(pSw));
    const { data: swBooking } = await db.from("bookings").select("id, status, service_id").eq("immediate_request_id", pSw).maybeSingle();
    check("sw confirm → a booking row linked by immediate_request_id", !!swBooking, swBooking?.id);
    check("sw booking is active (status 'confirmed')", swBooking?.status === "confirmed", swBooking?.status);
    check("sw confirm → availability switched OFF", (await isAvailable(pracSw.id)) === false);

    console.log("\n=== commission confirm → hold, no booking ===");
    const pComm = await insertPending(client.id, pracComm.id, svcComm);
    await loginAs(pracComm.email);
    await makeAvailableAndOpen(pracComm.id);
    await page.getByRole("button", { name: "Потвърди" }).first().waitFor({ timeout: 12000 });
    await page.getByRole("button", { name: "Потвърди" }).first().click();
    await page.waitForTimeout(2500);
    check("commission confirm → request 'confirmed'", (await reqStatus(pComm)) === "confirmed", await reqStatus(pComm));
    const { data: hold } = await db.from("immediate_holds").select("id, start_utc, end_utc, expires_at").eq("request_id", pComm).maybeSingle();
    check("commission confirm → a payment-window hold exists", !!hold, hold?.id);
    check("commission confirm → NO booking yet", !(await db.from("bookings").select("id").eq("immediate_request_id", pComm).maybeSingle()).data);
    check("commission confirm → availability switched OFF", (await isAvailable(pracComm.id)) === false);

    console.log("\n=== fit re-checked at confirm (before the billing branch) ===");
    // The confirm-time fit re-check is now a server guard behind the toggle's
    // auto-off: a practitioner is bookable when the request shows, THEN a conflict
    // appears, and confirm (clicked before the next auto-off tick) must re-check
    // and decline. Clean pracComm's prior hold/requests so it's freshly bookable.
    await db.from("immediate_holds").delete().eq("practitioner_id", pracComm.id);
    await db.from("immediate_requests").delete().eq("practitioner_id", pracComm.id);
    const pFit = await insertPending(client.id, pracComm.id, svcComm);
    await loginAs(pracComm.email);
    await makeAvailableAndOpen(pracComm.id); // no conflict yet → stays available, request shows
    await page.getByRole("button", { name: "Потвърди" }).first().waitFor({ timeout: 12000 });
    // A scheduled session now overlaps the immediate window; confirm immediately,
    // before the next 10s tick would auto-off availability.
    await db.from("bookings").insert({ practitioner_id: pracComm.id, client_id: client.id, service_id: svcComm, start_utc: iso(2 * 60000), end_utc: iso(50 * 60000), delivery_type: "online", service_name: "sched", price_cents: 5000, currency: "EUR" });
    await page.getByRole("button", { name: "Потвърди" }).first().click();
    await page.waitForTimeout(2500);
    check("confirm that no longer fits → declined, NOT booked", (await reqStatus(pFit)) === "declined", await reqStatus(pFit));
    check("no-fit → no booking created", !(await db.from("bookings").select("id").eq("immediate_request_id", pFit).maybeSingle()).data);

    console.log("\n=== confirmation page: booked → Join ===");
    // Simulate the webhook/confirm having produced the booking.
    const pBooked = await insertPending(client.id, pracComm.id, svcComm);
    await db.from("immediate_requests").update({ status: "booked", responded_at: new Date().toISOString() }).eq("id", pBooked);
    await db.from("bookings").insert({ practitioner_id: pracComm.id, client_id: client.id, service_id: svcComm, immediate_request_id: pBooked, start_utc: iso(0), end_utc: iso(30 * 60000), delivery_type: "online", service_name: "IM Svc", price_cents: 5000, currency: "EUR" });
    await loginAs(client.email);
    await page.goto(`${BASE}/bg/immediate/${pBooked}`, { waitUntil: "networkidle" });
    await page.waitForTimeout(3500);
    check("confirmation page shows Join once the booking exists", await page.getByRole("link", { name: "Влез в сесията" }).first().isVisible().catch(() => false));

    console.log("\n=== confirmation page: cancelled → release + free ===");
    await present(pracComm.id, false);
    const pCancel = await insertPending(client.id, pracComm.id, svcComm);
    await db.from("immediate_requests").update({ status: "confirmed", responded_at: new Date().toISOString(), projected_start_at: iso(3 * 60000), projected_end_at: iso(33 * 60000) }).eq("id", pCancel);
    await db.from("immediate_holds").insert({ practitioner_id: pracComm.id, request_id: pCancel, start_utc: iso(3 * 60000), end_utc: iso(33 * 60000), expires_at: iso(5 * 60000) });
    await page.goto(`${BASE}/bg/immediate/${pCancel}?payment=cancelled`, { waitUntil: "networkidle" });
    await page.waitForTimeout(2500);
    check("cancelled → request 'payment_failed'", (await reqStatus(pCancel)) === "payment_failed", await reqStatus(pCancel));
    check("cancelled → hold released", !(await db.from("immediate_holds").select("id").eq("request_id", pCancel).maybeSingle()).data);
    check("cancelled → practitioner available again", (await isAvailable(pracComm.id)) === true);
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
    await db.from("feature_flags").delete().eq("key", "immediateBooking");
    console.log(`\ncleaned up ${created.length} users + flag`);
    console.log(failures === 0 ? "ALL PASS ✓" : `${failures} FAIL ✗`);
    process.exit(failures === 0 ? 0 : 1);
  }
})();
