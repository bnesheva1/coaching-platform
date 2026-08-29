// Session documents — GDPR export + deletion verification.
//   - Data export (ZIP): includes metadata for BOTH sides' documents on the
//     user's bookings, embeds ONLY the user's own uploaded files, never the
//     counterparty's bytes.
//   - Account deletion: purges the user's uploaded files + metadata rows and
//     anonymises (nulls actor_id on) their event-log entries, keeping
//     filename/size/type; leaves the counterparty's document untouched.
//
// Requires migrations applied + the dev server running. Playwright + jszip.
// Run: node --env-file=.env.local scripts/verify-documents-gdpr.mjs
import { createClient } from "@supabase/supabase-js";
import { chromium } from "playwright";
import JSZip from "jszip";

const BASE = "http://localhost:3000";
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const db = createClient(url, process.env.SUPABASE_SECRET_KEY);
const BUCKET = "session-documents";
const PW = "twelvecharspw1";
const stamp = Date.now();
const created = [];
let failures = 0;
const check = (l, c, d) => { if (!c) failures++; console.log(`${c ? "PASS" : "FAIL"} — ${l}${d !== undefined ? `  (${d})` : ""}`); };

const CLIENT_BYTES = Buffer.from("%PDF-1.4\nCLIENT-OWN-DOC\n%%EOF\n");
const PRAC_BYTES = Buffer.from("%PDF-1.4\nPRACTITIONER-DOC\n%%EOF\n");

async function mkUser(role, name) {
  const email = `gdpr-${role}-${stamp}-${Math.random().toString(36).slice(2, 5)}@example.com`;
  const { data, error } = await db.auth.admin.createUser({ email, password: PW, email_confirm: true, user_metadata: { role, display_name: name } });
  if (error) throw error;
  created.push(data.user.id);
  await new Promise((r) => setTimeout(r, 300));
  return { id: data.user.id, email, name };
}

async function seedDoc(bookingId, side, uploaderId, bytes) {
  const path = `${bookingId}/${side}/${crypto.randomUUID()}.pdf`;
  await db.storage.from(BUCKET).upload(path, bytes, { contentType: "application/pdf" });
  await db.from("session_documents").insert({ booking_id: bookingId, side, uploader_id: uploaderId, file_name: `${side}-doc.pdf`, byte_size: bytes.length, mime_type: "application/pdf", storage_path: path });
  await db.from("session_document_events").insert({ booking_id: bookingId, side, actor_id: uploaderId, action: "uploaded", file_name: `${side}-doc.pdf`, byte_size: bytes.length, mime_type: "application/pdf" });
  return path;
}

async function main() {
  console.log("=== Setup ===");
  const clientName = `GDPR Client ${stamp}`;
  const prac = await mkUser("practitioner", `GDPR Prac ${stamp}`);
  const client = await mkUser("client", clientName);
  for (let i = 0; i < 20; i++) { if ((await db.from("practitioner_profiles").select("id").eq("id", prac.id).maybeSingle()).data) break; await new Promise((r) => setTimeout(r, 200)); }
  await db.from("practitioner_profiles").update({ username: `gdpr${stamp}`, timezone: "Europe/Sofia", bio: "b", headline: "h", location: "Sofia", specialties: ["coaching"], billing_model: "software_provider" }).eq("id", prac.id);
  const service = (await db.from("services").insert({ practitioner_id: prac.id, name: "Consult", duration_minutes: 60, price_cents: 5000, currency: "EUR", is_active: true, delivery_type: "online" }).select("id").single()).data;
  // A PAST booking (so account deletion isn't blocked by an upcoming one).
  const start = new Date(Date.now() - 3 * 864e5);
  const booking = (await db.from("bookings").insert({ practitioner_id: prac.id, client_id: client.id, service_id: service.id, start_utc: start.toISOString(), end_utc: new Date(start.getTime() + 36e5).toISOString(), status: "completed", delivery_type: "online", service_name: "Consult", price_cents: 5000, currency: "EUR", documents_enabled: true }).select("id").single()).data;
  const clientPath = await seedDoc(booking.id, "client", client.id, CLIENT_BYTES);
  const pracPath = await seedDoc(booking.id, "practitioner", prac.id, PRAC_BYTES);
  console.log(`  booking=${booking.id}`);

  const browser = await chromium.launch();
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

  try {
    console.log("\n=== Export: ZIP includes own file + both metadata, not counterparty bytes ===");
    await loginAs(client.email);
    const res = await ctx.request.get(`${BASE}/bg/settings/export`);
    check("export route returns 200", res.status() === 200, res.status());
    check("export is a zip", (res.headers()["content-type"] || "").includes("zip"), res.headers()["content-type"]);
    const zip = await JSZip.loadAsync(await res.body());
    const manifest = JSON.parse(await zip.file("export.json").async("string"));
    const docs = manifest.sessionDocuments ?? [];
    check("export.json lists both documents' metadata", docs.length === 2, JSON.stringify(docs.map((d) => d.side)));
    const own = docs.find((d) => d.side === "client");
    const theirs = docs.find((d) => d.side === "practitioner");
    check("own document marked uploadedByMe with a file path", own && own.uploadedByMe === true && !!own.file, JSON.stringify(own));
    check("counterparty document metadata present but uploadedByMe=false, no file", theirs && theirs.uploadedByMe === false && theirs.file === null, JSON.stringify(theirs));
    const zipPaths = Object.keys(zip.files).filter((p) => p.startsWith("documents/") && !zip.files[p].dir);
    check("ZIP contains exactly one document file (the user's own)", zipPaths.length === 1, JSON.stringify(zipPaths));
    const embedded = own?.file ? await zip.file(own.file).async("nodebuffer") : null;
    check("embedded file bytes match the user's own upload", embedded && embedded.equals(CLIENT_BYTES));
    check("counterparty bytes are NOT in the export", !zipPaths.some((p) => p.includes("practitioner")));

    console.log("\n=== Deletion: purge own docs, anonymise events, keep counterparty ===");
    await page.goto(`${BASE}/bg/client-dashboard/settings`, { waitUntil: "networkidle" });
    // Open the collapsed delete section, type the display name to confirm, submit.
    await page.getByText("Изтриване на профила", { exact: false }).first().click().catch(() => {});
    await page.locator('input[type="text"]').last().fill(clientName);
    await Promise.all([
      page.waitForURL((u) => u.pathname.includes("/account-deleted"), { timeout: 30000 }).catch(() => {}),
      page.locator("form button[type=submit]").last().click(),
    ]);
    await page.waitForTimeout(2000);

    const clientRows = (await db.from("session_documents").select("id").eq("uploader_id", client.id)).data ?? [];
    check("client's session_documents rows are deleted", clientRows.length === 0, `${clientRows.length} left`);
    const clientObj = await db.storage.from(BUCKET).download(clientPath);
    check("client's storage object is removed", !!clientObj.error);
    const clientEvents = (await db.from("session_document_events").select("actor_id, file_name").eq("booking_id", booking.id).eq("side", "client")).data ?? [];
    check("client's event actor_id is anonymised to null", clientEvents.length > 0 && clientEvents.every((e) => e.actor_id === null), JSON.stringify(clientEvents));
    check("client's event keeps filename/size/type (exchange facts)", clientEvents.every((e) => e.file_name === "client-doc.pdf"));
    const pracRows = (await db.from("session_documents").select("id").eq("uploader_id", prac.id)).data ?? [];
    check("counterparty's session_documents row is UNTOUCHED", pracRows.length === 1);
    const pracObj = await db.storage.from(BUCKET).download(pracPath);
    check("counterparty's storage object is UNTOUCHED", !pracObj.error);
  } finally {
    await browser.close();
  }

  console.log("\n=== Cleanup ===");
  await db.from("session_document_events").delete().eq("booking_id", booking.id);
  await db.from("session_documents").delete().eq("booking_id", booking.id);
  await db.from("bookings").delete().eq("id", booking.id);
  await db.storage.from(BUCKET).remove([clientPath, pracPath]).catch(() => {});
  for (const id of created) await db.auth.admin.deleteUser(id).catch(() => {});

  console.log(`\n${failures === 0 ? "ALL PASSED" : `${failures} FAILURE(S)`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
