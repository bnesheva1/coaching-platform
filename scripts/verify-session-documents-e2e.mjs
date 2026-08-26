// Session documents — browser E2E. Drives the real UI end to end:
//   1. Practitioner service form: the "allow file exchange" toggle persists
//      to services.documents_enabled.
//   2. Booking details on the practitioner dashboard: the documents block
//      shows for a booking whose service opted in, is ABSENT for one that
//      didn't, and a real upload appears with its filename.
//   3. Client dashboard: the client sees the practitioner's uploaded
//      document and downloads it via a short-lived signed URL.
//
// Requires all four migrations applied AND the dev server running with the
// feature flag on:
//   SESSION_DOCUMENTS_ENABLED=true npm run dev
// Run: node --env-file=.env.local scripts/verify-session-documents-e2e.mjs
import { createClient } from "@supabase/supabase-js";
import { chromium } from "playwright";
import { writeFileSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const BASE = "http://localhost:3000";
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SECRET_KEY);
const PW = "twelvecharspw1";
const stamp = Date.now();
const DAY = 864e5;
let failures = 0;
const created = [];
const check = (l, c, d) => { if (!c) failures++; console.log(`${c ? "PASS" : "FAIL"} — ${l}${d !== undefined ? `  (${d})` : ""}`); };

// A real minimal PDF (the %PDF- header is what file-type sniffs).
const pdfPath = join(tmpdir(), `e2e-doc-${stamp}.pdf`);
writeFileSync(pdfPath, Buffer.from("%PDF-1.4\n%\xE2\xE3\xCF\xD3\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n", "latin1"));

async function mk(role, name) {
  const email = `sde-${role}-${stamp}-${Math.random().toString(36).slice(2, 5)}@example.com`;
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
}

const serviceDocsEnabled = async (id) => (await db.from("services").select("documents_enabled").eq("id", id).single()).data?.documents_enabled;

(async () => {
  let browser;
  try {
    console.log("=== Setup ===");
    const prac = await mk("practitioner", `E2E Prac ${stamp}`);
    const client = await mk("client", `E2E Client ${stamp}`);
    await setupPractitioner(prac, `e2e${stamp}`);
    // One service, file exchange OFF initially — the form test flips it on.
    const service = (await db.from("services").insert({ practitioner_id: prac.id, name: "Consult", duration_minutes: 60, price_cents: 5000, currency: "EUR", is_active: true, delivery_type: "online", documents_enabled: false }).select("id").single()).data;

    // Two upcoming bookings with distinct service_name snapshots so the UI
    // can be targeted. B_off is earliest (becomes the client hero, which has
    // no details disclosure); B_on is later (lands in the list, where the
    // disclosure lives). Spaced days apart — no GiST overlap.
    const mkBooking = async (offsetDays, name, docs) => {
      const start = new Date(Date.now() + offsetDays * DAY);
      const end = new Date(start.getTime() + 36e5);
      return (await db.from("bookings").insert({ practitioner_id: prac.id, client_id: client.id, service_id: service.id, start_utc: start.toISOString(), end_utc: end.toISOString(), status: "confirmed", delivery_type: "online", service_name: name, price_cents: 5000, currency: "EUR", delivery_info: null, documents_enabled: docs }).select("id").single()).data.id;
    };
    const bOff = await mkBooking(2, "Consult-OFF", false);
    const bOn = await mkBooking(5, "Consult-ON", true);
    console.log(`  service=${service.id} bOn=${bOn} bOff=${bOff}`);

    browser = await chromium.launch();
    const ctx = await browser.newContext();
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
    const detailsFor = (text) => page.locator("details").filter({ hasText: text });

    console.log("\n=== 1. Practitioner service form: the toggle ===");
    await loginAs(prac.email);
    await page.goto(`${BASE}/bg/practitioner-dashboard/services`, { waitUntil: "networkidle" });
    await page.getByRole("button", { name: "Редактирай" }).first().click();
    const toggle = page.locator('input[name="documentsEnabled"]');
    check("'allow file exchange' toggle present in the edit form", await toggle.isVisible().catch(() => false));
    check("toggle starts unchecked (service was off)", !(await toggle.isChecked().catch(() => true)));
    await toggle.check();
    await page.getByRole("button", { name: "Запази", exact: true }).click();
    await page.waitForTimeout(1500);
    check("saving flips services.documents_enabled to true", (await serviceDocsEnabled(service.id)) === true);

    console.log("\n=== 2. Practitioner bookings: block gated per booking + real upload ===");
    await page.goto(`${BASE}/bg/practitioner-dashboard/bookings`, { waitUntil: "networkidle" });

    const onDetails = detailsFor("Consult-ON");
    await onDetails.locator("summary").click();
    check("documents block shows for the file-exchange booking", await onDetails.getByText("Документи").first().isVisible().catch(() => false));

    const offDetails = detailsFor("Consult-OFF");
    await offDetails.locator("summary").click();
    check("documents block ABSENT for the booking whose service opted out", !(await offDetails.getByText("Документи").first().isVisible().catch(() => false)));

    // Upload into the practitioner's own slot on B_on (hidden input; setInputFiles
    // fires change → the form auto-submits).
    await onDetails.locator('input[name="file"]').setInputFiles(pdfPath);
    await page.waitForTimeout(2500);
    const uploadedName = pdfPath.split("/").pop();
    check("uploaded file appears in the practitioner's slot", await onDetails.getByText(uploadedName).first().isVisible().catch(() => false), uploadedName);
    check("booking now has a practitioner-side document row", !!(await db.from("session_documents").select("id").eq("booking_id", bOn).eq("side", "practitioner").maybeSingle()).data);
    check("an 'uploaded' event was logged", !!(await db.from("session_document_events").select("id").eq("booking_id", bOn).eq("action", "uploaded").maybeSingle()).data);

    console.log("\n=== 3. Client sees & downloads the counterparty document ===");
    await loginAs(client.email);
    await page.goto(`${BASE}/bg/client-dashboard`, { waitUntil: "networkidle" });
    const clientOn = detailsFor("Consult-ON");
    await clientOn.locator("summary").click();
    check("client sees the practitioner's document (their slot)", await clientOn.getByText("Документ от другата страна").first().isVisible().catch(() => false));
    check("client sees the uploaded filename", await clientOn.getByText(uploadedName).first().isVisible().catch(() => false));

    // Download opens a short-lived signed URL via window.open. Stub it to
    // capture the exact URL — a noopener popup to a file URL isn't reliably
    // observable as a Playwright 'page' event in headless Chromium.
    await page.evaluate(() => {
      window.__openedUrl = null;
      window.open = (u) => { window.__openedUrl = String(u); return null; };
    });
    await clientOn.getByRole("button", { name: "Изтегляне" }).click();
    await page.waitForTimeout(2000);
    const openedUrl = await page.evaluate(() => window.__openedUrl);
    check("download minted a signed session-documents URL", !!openedUrl && openedUrl.includes("session-documents") && openedUrl.includes("token="), openedUrl?.slice(0, 90));
  } catch (err) {
    console.error("\n!!! aborted:", err.stack || err.message);
    failures++;
  } finally {
    if (browser) await browser.close();
    try { unlinkSync(pdfPath); } catch { /* ignore */ }
    for (const id of created) {
      const b = await db.from("bookings").select("id").or(`practitioner_id.eq.${id},client_id.eq.${id}`);
      for (const row of b.data ?? []) {
        await db.from("session_document_events").delete().eq("booking_id", row.id);
        await db.from("session_documents").delete().eq("booking_id", row.id);
      }
      await db.from("bookings").delete().or(`practitioner_id.eq.${id},client_id.eq.${id}`);
    }
    // Best-effort: clear any stored objects for the practitioner's bookings.
    for (const id of created) await db.auth.admin.deleteUser(id).catch(() => {});
    console.log(`\ncleaned up ${created.length} users`);
    console.log(failures === 0 ? "ALL PASS ✓" : `${failures} FAIL ✗`);
    process.exit(failures === 0 ? 0 : 1);
  }
})();
