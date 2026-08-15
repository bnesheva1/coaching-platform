// Slice 3 verification: bulk cancel-and-refund, end to end (the money slice).
// Three bookings with different payment states drive the three outcomes; then
// re-run safety, the practitioner summary, the audit detail, and the sweep-skip
// propagation are checked.
// Run: node --env-file=.env.local scripts/verify-bulk-cancel-e2e.mjs
import { createClient } from "@supabase/supabase-js";
import Stripe from "stripe";
import { chromium } from "playwright";

const BASE = "http://localhost:3000";
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SECRET_KEY);
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const CONNECTED = "acct_1TxUsC2NdM7GPd6i"; // real test connected account (transfers active)
const PW = "twelvecharspw1";
const stamp = Date.now();
let failures = 0;
const created = [];
const bookingIds = [];
function check(label, cond, detail) {
  if (!cond) failures++;
  console.log(`${cond ? "PASS" : "FAIL"} — ${label}${detail !== undefined ? `  (${detail})` : ""}`);
}
async function mk(role, name) {
  const email = `bc-${role}-${stamp}-${Math.random().toString(36).slice(2, 5)}@example.com`;
  const { data, error } = await db.auth.admin.createUser({ email, password: PW, email_confirm: true, user_metadata: { role, display_name: name } });
  if (error) throw error;
  created.push(data.user.id);
  await new Promise((r) => setTimeout(r, 400));
  return { id: data.user.id, email };
}
async function makeBooking(pracId, clientId, serviceId, hoursAhead) {
  const start = new Date(Date.now() + hoursAhead * 3600_000).toISOString();
  const end = new Date(Date.now() + (hoursAhead + 0.5) * 3600_000).toISOString();
  const { data, error } = await db.from("bookings").insert({
    practitioner_id: pracId, client_id: clientId, service_id: serviceId,
    start_utc: start, end_utc: end, delivery_type: "online",
    service_name: "BC Session", price_cents: 5000, currency: "EUR", meeting_link: "https://example.com/m",
  }).select("id").single();
  if (error) throw new Error("booking insert: " + error.message);
  bookingIds.push(data.id);
  return data.id;
}

(async () => {
  let browser;
  try {
    console.log("=== Setup ===");
    const admin = await mk("client", "BC Admin");
    await db.from("profiles").update({ role: "admin" }).eq("id", admin.id);
    const client = await mk("client", "BC Client");
    const prac = await mk("practitioner", "BC Prac");
    for (let i = 0; i < 20; i++) { if ((await db.from("practitioner_profiles").select("id").eq("id", prac.id).maybeSingle()).data) break; await new Promise((r) => setTimeout(r, 200)); }
    const username = `bcprac${stamp}`;
    await db.from("practitioner_profiles").update({ username, timezone: "Europe/Sofia", billing_model: "commission" }).eq("id", prac.id);
    const { data: svc } = await db.from("services").insert({ practitioner_id: prac.id, name: "BC Svc", duration_minutes: 30, price_cents: 5000, currency: "EUR", is_active: true, delivery_type: "online", delivery_info: "x" }).select("id").single();

    // B1: no payment (software-provider-style). B2: fake PI → refund fails. B3: real PI → refund succeeds.
    const b1 = await makeBooking(prac.id, client.id, svc.id, 48);
    const b2 = await makeBooking(prac.id, client.id, svc.id, 72);
    const b3 = await makeBooking(prac.id, client.id, svc.id, 96);
    const e2 = await db.from("payments").insert({ booking_id: b2, stripe_checkout_session_id: "cs_bogus_b2_" + stamp, status: "succeeded", amount_cents: 5000, commission_cents: 750, currency: "EUR", provider: "stripe", provider_ref: { payment_intent_id: "pi_bogus_" + stamp } });
    if (e2.error) console.log("  b2 payment insert err:", e2.error.message);
    const pi = await stripe.paymentIntents.create({ amount: 5000, currency: "eur", payment_method: "pm_card_visa", confirm: true, application_fee_amount: 750, transfer_data: { destination: CONNECTED }, automatic_payment_methods: { enabled: true, allow_redirects: "never" } });
    const e3 = await db.from("payments").insert({ booking_id: b3, stripe_checkout_session_id: "cs_real_b3_" + stamp, status: "succeeded", amount_cents: 5000, commission_cents: 750, currency: "EUR", provider: "stripe", provider_ref: { payment_intent_id: pi.id } });
    if (e3.error) console.log("  b3 payment insert err:", e3.error.message);
    const ctxProbe = await db.rpc("get_booking_email_context", { target_booking_id: b1 });
    console.log("  email-context probe (service role):", ctxProbe.error ? "ERR " + ctxProbe.error.message : (ctxProbe.data ? "resolved" : "NULL"));
    console.log(`bookings: b1(no-pay) b2(fake-pi) b3(real-pi ${pi.id})`);

    browser = await chromium.launch();
    const page = await browser.newContext().then((c) => c.newPage());
    page.on("console", (m) => { if (m.type() === "error") console.log("  [browser err]", m.text().slice(0, 200)); });
    page.on("pageerror", (e) => console.log("  [pageerror]", e.message.slice(0, 200)));
    await page.goto(`${BASE}/bg/login`, { waitUntil: "domcontentloaded" });
    await page.fill('input[name="email"]', admin.email);
    await page.fill('input[name="password"]', PW);
    await page.click('button[type="submit"]');
    await page.waitForURL((u) => !u.pathname.includes("/login"), { timeout: 30000 });

    console.log("\n=== Preview ===");
    await page.goto(`${BASE}/bg/admin/practitioners/${prac.id}/cancel`, { waitUntil: "networkidle" });
    await page.waitForSelector('textarea[name="reason"]', { timeout: 15000 });
    const body = await page.evaluate(() => document.body.innerText);
    check("preview shows 3 bookings", /\b3\b/.test(body) && body.includes("записвания"));
    check("preview shows a no-payment count", body.includes("без запис за плащане"));

    console.log("\n=== Execute (via the real confirm UI) ===");
    await page.fill('textarea[name="reason"]', "Практикуващият не е на разположение");
    await page.fill('input[name="confirmUsername"]', username);
    await page.getByRole("button", { name: "Отмени всички и възстанови" }).click();
    try {
      await page.waitForSelector("text=Готово", { timeout: 45000 });
    } catch (e) {
      console.log("  [execute diag] body:", (await page.evaluate(() => document.body.innerText)).replace(/\s+/g, " ").slice(0, 400));
      throw e;
    }

    // DB assertions
    const statuses = Object.fromEntries((await db.from("bookings").select("id, status, cancellation_notice_sent_at, cancellation_batch_id").in("id", [b1, b2, b3])).data.map((r) => [r.id, r]));
    console.log("  markers:", [b1, b2, b3].map((id) => `${statuses[id].status}/${statuses[id].cancellation_notice_sent_at ? "emailed" : "NOT-emailed"}`).join(" "));
    check("all three cancelled_by_admin", [b1, b2, b3].every((id) => statuses[id].status === "cancelled_by_admin"));
    check("all three have the client-email marker set", [b1, b2, b3].every((id) => statuses[id].cancellation_notice_sent_at));
    check("all three stamped with a batch id", [b1, b2, b3].every((id) => statuses[id].cancellation_batch_id));

    const pay2 = (await db.from("payments").select("status").eq("booking_id", b2).maybeSingle()).data ?? {};
    const pay3 = (await db.from("payments").select("status").eq("booking_id", b3).maybeSingle()).data ?? {};
    check("b3 (real PI) refunded", pay3.status === "refunded", pay3.status);
    check("b2 (fake PI) NOT refunded — refund failed", pay2.status === "succeeded", pay2.status);
    const alert = (await db.from("alerts").select("type, subject").eq("type", "failed_refund").eq("subject", b2).maybeSingle()).data;
    check("b2 raised a failed_refund alert", !!alert);

    const batch = (await db.from("bulk_cancellations").select("id, practitioner_notified_at, completed_at").eq("practitioner_id", prac.id).single()).data;
    check("batch: practitioner summary sent once", !!batch.practitioner_notified_at);
    check("batch: marked complete", !!batch.completed_at);

    const audit = (await db.from("admin_audit_log").select("action, detail").eq("action", "practitioner.bulk_cancel").order("created_at", { ascending: false }).limit(1).single()).data;
    check("audit row with detail jsonb (per-booking outcomes)", audit?.detail?.outcomes?.length === 3, JSON.stringify(audit?.detail?.counts));

    console.log("\n=== Re-run safety ===");
    await page.goto(`${BASE}/bg/admin/practitioners/${prac.id}/cancel`, { waitUntil: "networkidle" });
    const body2 = await page.evaluate(() => document.body.innerText);
    check("re-visit shows nothing to cancel (already done, excluded)", body2.includes("няма предстоящи записвания"));
    const pay3After = (await db.from("payments").select("status").eq("booking_id", b3).single()).data;
    check("b3 still refunded once (no double refund)", pay3After.status === "refunded");

    console.log("\n=== Propagation: alert sweep skips cancelled online sessions ===");
    // Give b1 a video_session past its window; the sweep must NOT flag it (booking cancelled).
    await db.from("video_sessions").insert({ booking_id: b1, opens_at: new Date(Date.now() - 7200_000).toISOString(), closes_at: new Date(Date.now() - 3600_000).toISOString(), status: "scheduled" });
    await fetch(`${BASE}/api/cron/send-reminders`, { headers: { authorization: `Bearer ${process.env.CRON_SECRET}` } });
    await new Promise((r) => setTimeout(r, 1500));
    const sessAlert = (await db.from("alerts").select("id").eq("type", "session_failed").eq("subject", b1).maybeSingle()).data;
    check("no session_failed alert for the cancelled booking's session", !sessAlert);
  } catch (err) {
    console.error("\n!!! aborted:", err.message);
    failures++;
  } finally {
    if (browser) await browser.close();
    for (const id of bookingIds) {
      await db.from("alerts").delete().eq("subject", id);
      await db.from("video_sessions").delete().eq("booking_id", id);
      await db.from("payments").delete().eq("booking_id", id);
    }
    for (const id of created) await db.auth.admin.deleteUser(id).catch(() => {});
    console.log(`\ncleaned up ${created.length} users`);
    console.log(failures === 0 ? "ALL PASS ✓" : `${failures} FAILURE(S) ✗`);
    process.exit(failures === 0 ? 0 : 1);
  }
})();
