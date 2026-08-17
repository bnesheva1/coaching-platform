// Immediate booking slice 1 verification: presence + the request/confirm state
// machine. DB-level checks (presence function, one-live index), then the
// handshake driven through the practitioner's real AvailabilityWidget.
// Run: node --env-file=.env.local scripts/verify-immediate-e2e.mjs
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
  const email = `im-${role}-${stamp}-${Math.random().toString(36).slice(2, 5)}@example.com`;
  const { data, error } = await db.auth.admin.createUser({ email, password: PW, email_confirm: true, user_metadata: { role, display_name: name } });
  if (error) throw error;
  created.push(data.user.id);
  await new Promise((r) => setTimeout(r, 400));
  return { id: data.user.id, email };
}
const iso = (msFromNow) => new Date(Date.now() + msFromNow).toISOString();
async function insertPending(clientId, pracId, serviceId, expiresMs = 120000) {
  const { data } = await db.from("immediate_requests").insert({ client_id: clientId, practitioner_id: pracId, service_id: serviceId, expires_at: iso(expiresMs) }).select("id").single();
  return data.id;
}
const reqStatus = async (id) => (await db.from("immediate_requests").select("status").eq("id", id).single()).data?.status;
const isAvailable = async (id) => (await db.rpc("is_practitioner_available_now", { target: id })).data;

(async () => {
  let browser;
  try {
    console.log("=== Enable flag + settle cache ===");
    await db.from("feature_flags").upsert({ key: "immediateBooking", enabled: true, updated_at: new Date().toISOString() }, { onConflict: "key" });

    console.log("=== Setup + DB-level checks (during cache settle) ===");
    const client = await mk("client", `IM Client ${stamp}`);
    const prac = await mk("practitioner", "IM Prac");
    for (let i = 0; i < 20; i++) { if ((await db.from("practitioner_profiles").select("id").eq("id", prac.id).maybeSingle()).data) break; await new Promise((r) => setTimeout(r, 200)); }
    const username = `improc${stamp}`;
    await db.from("practitioner_profiles").update({ username, timezone: "UTC", avatar_url: "x", bio: "b", headline: "h", location: "Sofia", specialties: ["coaching"] }).eq("id", prac.id);
    await db.from("practitioner_availability").insert([1, 2, 3, 4, 5, 6, 7].map((d) => ({ practitioner_id: prac.id, day_of_week: d, start_time: "00:00:00", end_time: "23:45:00" })));
    const { data: svc } = await db.from("services").insert({ practitioner_id: prac.id, name: "IM Svc", duration_minutes: 30, price_cents: 5000, currency: "EUR", is_active: true, delivery_type: "online", delivery_info: "x" }).select("id").single();

    // is_practitioner_available_now: off / fresh / stale
    check("presence: unset → not available", (await isAvailable(prac.id)) === false);
    await db.from("immediate_presence").upsert({ practitioner_id: prac.id, available_now: true, last_heartbeat_at: new Date().toISOString() });
    check("presence: available + fresh heartbeat → available", (await isAvailable(prac.id)) === true);
    await db.from("immediate_presence").update({ last_heartbeat_at: iso(-60000) }).eq("practitioner_id", prac.id);
    check("presence: stale heartbeat → NOT available (safe degrade)", (await isAvailable(prac.id)) === false);
    await db.from("immediate_presence").update({ available_now: false, last_heartbeat_at: null }).eq("practitioner_id", prac.id);

    // one-live unique index
    const l1 = await insertPending(client.id, prac.id, svc.id);
    const dup = await db.from("immediate_requests").insert({ client_id: client.id, practitioner_id: prac.id, service_id: svc.id, expires_at: iso(120000) });
    check("one-live index blocks a second pending for the same pair", !!dup.error && dup.error.code === "23505");
    await db.from("immediate_requests").delete().eq("id", l1);

    const waited = Date.now() - stamp;
    const remain = Math.max(0, 65000 - waited);
    console.log(`  waiting ${Math.round(remain / 1000)}s more for the flag cache…`);
    await new Promise((r) => setTimeout(r, remain));

    browser = await chromium.launch();
    const ctx = await browser.newContext();
    await ctx.grantPermissions(["notifications"], { origin: BASE });
    const page = await ctx.newPage();
    page.on("console", (m) => { if (m.type() === "error") console.log("  [browser err]", m.text().slice(0, 200)); });
    page.on("pageerror", (e) => console.log("  [pageerror]", e.message.slice(0, 200)));
    await page.goto(`${BASE}/bg/login`, { waitUntil: "domcontentloaded" });
    await page.fill('input[name="email"]', prac.email);
    await page.fill('input[name="password"]', PW);
    await page.click('button[type="submit"]');
    await page.waitForURL((u) => !u.pathname.includes("/login"), { timeout: 30000 });

    // Drive the widget into the available+ticking state via the DB resume-path
    // (exactly what the widget does on reload with a fresh heartbeat) — headless
    // Chromium won't grant the notification the go-available button gates on.
    async function makeAvailable() {
      // Clear any booking/hold a prior sub-test's confirm left behind, so this
      // shared practitioner is actually bookable — otherwise the tick would now
      // auto-switch availability off (§4) and the inbox would never appear.
      await db.from("immediate_holds").delete().eq("practitioner_id", prac.id);
      await db.from("bookings").delete().eq("practitioner_id", prac.id);
      await db.from("immediate_presence").upsert(
        { practitioner_id: prac.id, available_now: true, last_heartbeat_at: new Date().toISOString(), updated_at: new Date().toISOString() },
        { onConflict: "practitioner_id" },
      );
      await page.goto(`${BASE}/bg/practitioner-dashboard`, { waitUntil: "networkidle" });
      await page.waitForTimeout(1500); // resume + first tick
    }

    console.log("\n=== Presence / heartbeat via the widget tick ===");
    await db.from("immediate_presence").upsert({ practitioner_id: prac.id, available_now: true, last_heartbeat_at: iso(-20000), updated_at: new Date().toISOString() }, { onConflict: "practitioner_id" });
    await page.goto(`${BASE}/bg/practitioner-dashboard`, { waitUntil: "networkidle" });
    await page.waitForTimeout(12000); // > one 10s tick
    const hb = (await db.from("immediate_presence").select("last_heartbeat_at").eq("practitioner_id", prac.id).single()).data.last_heartbeat_at;
    check("open widget's tick refreshes the heartbeat", Date.now() - new Date(hb).getTime() < 11000, `age ${Math.round((Date.now() - new Date(hb).getTime()) / 1000)}s`);

    console.log("\n=== Confirm ===");
    const p1 = await insertPending(client.id, prac.id, svc.id);
    await makeAvailable();
    await page.getByText(`IM Client ${stamp}`).waitFor({ timeout: 12000 });
    await page.getByRole("button", { name: "Потвърди" }).first().click();
    await page.waitForTimeout(2000);
    // software_provider (this practitioner's default billing model) books on
    // confirm — status 'booked', not the pre-slice-2 'confirmed'.
    check("confirm → request booked", (await reqStatus(p1)) === "booked", await reqStatus(p1));
    check("confirm → availability switched OFF", (await isAvailable(prac.id)) === false);

    console.log("\n=== Supersede (collision) ===");
    const p2 = await insertPending(client.id, prac.id, svc.id);
    const client2 = await mk("client", `IM Client2 ${stamp}`);
    const p3 = await insertPending(client2.id, prac.id, svc.id);
    await makeAvailable();
    await page.getByRole("button", { name: "Потвърди" }).first().waitFor({ timeout: 12000 });
    await page.getByRole("button", { name: "Потвърди" }).first().click();
    await page.waitForTimeout(2000);
    const s2 = await reqStatus(p2), s3 = await reqStatus(p3);
    check("one booked, the other superseded", (s2 === "booked" && s3 === "superseded") || (s3 === "booked" && s2 === "superseded"), `${s2}/${s3}`);

    console.log("\n=== Decline ===");
    const p4 = await insertPending(client.id, prac.id, svc.id);
    await makeAvailable();
    await page.getByRole("button", { name: "Откажи" }).first().waitFor({ timeout: 12000 });
    await page.getByRole("button", { name: "Откажи" }).first().click();
    await page.waitForTimeout(1500);
    check("decline → request declined", (await reqStatus(p4)) === "declined");

    console.log("\n=== Lapse (expired pending) ===");
    const p5 = await insertPending(client.id, prac.id, svc.id, -5000);
    await makeAvailable(); // the tick lazily lapses it
    await page.waitForTimeout(1500);
    check("expired pending → lapsed by the tick", (await reqStatus(p5)) === "lapsed");

    console.log("\n=== Fit rejection (collision at confirm) ===");
    // Bookable when the request shows; the conflict appears just before confirm,
    // so the confirm-time re-check declines it (inserting the conflict first would
    // now auto-switch availability off before the request could even appear).
    const p6 = await insertPending(client.id, prac.id, svc.id);
    await makeAvailable();
    await page.getByRole("button", { name: "Потвърди" }).first().waitFor({ timeout: 12000 });
    await db.from("bookings").insert({ practitioner_id: prac.id, client_id: client.id, service_id: svc.id, start_utc: iso(2 * 60000), end_utc: iso(40 * 60000), delivery_type: "online", service_name: "sched", price_cents: 5000, currency: "EUR" });
    await page.getByRole("button", { name: "Потвърди" }).first().click();
    await page.waitForTimeout(2000);
    check("confirm that no longer fits → declined, not confirmed", (await reqStatus(p6)) === "declined");
  } catch (err) {
    console.error("\n!!! aborted:", err.message);
    failures++;
  } finally {
    if (browser) await browser.close();
    for (const id of created) {
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
