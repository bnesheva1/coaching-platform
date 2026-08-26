// Session document attachments — security & lifecycle verification.
//
// Proves the access-control discipline at the DB/storage layer (where it
// must hold regardless of the UI) plus the retention RPCs and the
// magic-byte allowlist decisions:
//   - storage RLS: a party writes only their own side; either party reads
//     either slot; a non-party reads nothing.
//   - metadata RLS + column grant: parties read slot metadata but NEVER
//     storage_path via a plain query; the definer RPC is the only reader,
//     and only for the two parties.
//   - append-only event log, readable by both parties, immutable.
//   - retention RPCs return the right rows and are service-role only.
//   - file-type allowlist: PDF/DOCX/legacy-DOC/TXT accepted, forged types
//     rejected.
//
// Requires migrations 20260825120000 + 20260825121000 applied.
// Run: node --env-file=.env.local scripts/verify-session-documents.mjs

import { createClient } from "@supabase/supabase-js";
import { fileTypeFromBuffer } from "file-type";

// Inline replica of lib/documents/validate.ts's decisions — kept here
// (rather than importing the .ts, which node can't resolve through its
// extensionless internal imports) so this script runs standalone. It must
// stay in lockstep with that module; the app itself uses the real one.
const ALLOWED = {
  "application/pdf": "pdf",
  "application/msword": "doc",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "text/plain": "txt",
};
function isUtf8Text(bytes) {
  if (bytes.includes(0)) return false;
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return true;
  } catch {
    return false;
  }
}
async function validateDocumentBytes(bytes, declaredType) {
  if (bytes.byteLength === 0) return { ok: false, reason: "empty" };
  const sniffed = await fileTypeFromBuffer(bytes);
  if (sniffed) {
    if (sniffed.mime in ALLOWED) return { ok: true, mime: sniffed.mime, ext: ALLOWED[sniffed.mime] };
    if (sniffed.mime === "application/x-cfb" && declaredType === "application/msword") return { ok: true, mime: "application/msword", ext: "doc" };
    return { ok: false, reason: "type" };
  }
  if (declaredType === "text/plain" && isUtf8Text(bytes)) return { ok: true, mime: "text/plain", ext: "txt" };
  return { ok: false, reason: "type" };
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const db = createClient(url, process.env.SUPABASE_SECRET_KEY);
const BUCKET = "session-documents";
const PW = "twelvecharspw1";
const stamp = Date.now();
const DAY = 24 * 60 * 60 * 1000;

let failures = 0;
const created = [];
const check = (label, cond, detail) => {
  if (!cond) failures++;
  console.log(`${cond ? "PASS" : "FAIL"} — ${label}${detail !== undefined ? `  (${detail})` : ""}`);
};

async function mkUser(role, name) {
  const email = `sd-${role}-${stamp}-${Math.random().toString(36).slice(2, 5)}@example.com`;
  const { data, error } = await db.auth.admin.createUser({
    email,
    password: PW,
    email_confirm: true,
    user_metadata: { role, display_name: name },
  });
  if (error) throw error;
  created.push(data.user.id);
  const client = createClient(url, anonKey);
  await client.auth.signInWithPassword({ email, password: PW });
  await new Promise((r) => setTimeout(r, 300));
  return { id: data.user.id, email, client };
}

// A minimal but genuine PDF (%PDF- header is enough for file-type).
const pdfBytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34, 0x0a, 0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a]);

async function main() {
  console.log("=== file-type allowlist decisions (DB-independent) ===");
  {
    const pdf = await validateDocumentBytes(pdfBytes, "application/pdf");
    check("real PDF accepted as pdf", pdf.ok && pdf.mime === "application/pdf", JSON.stringify(pdf));
    const ole = new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, ...new Array(24).fill(0)]);
    const doc = await validateDocumentBytes(ole, "application/msword");
    check("legacy OLE accepted as doc only when declared msword", doc.ok && doc.ext === "doc", JSON.stringify(doc));
    const oleNoDeclare = await validateDocumentBytes(ole, "application/pdf");
    check("legacy OLE rejected when NOT declared msword", !oleNoDeclare.ok);
    const txt = await validateDocumentBytes(new TextEncoder().encode("plain текст\n"), "text/plain");
    check("valid UTF-8 accepted as txt", txt.ok && txt.mime === "text/plain");
    const fakeTxt = await validateDocumentBytes(new Uint8Array([0x00, 0x01, 0x02, 0xff]), "text/plain");
    check("binary-with-NUL rejected even when declared text/plain", !fakeTxt.ok);
    const exe = await validateDocumentBytes(new Uint8Array([0x4d, 0x5a, 0x90, 0x00, ...new Array(20).fill(0)]), "application/pdf");
    check("PE executable renamed .pdf rejected", !exe.ok);
    const ftDocx = await fileTypeFromBuffer(new Uint8Array([0x50, 0x4b, 0x03, 0x04, ...new Array(26).fill(0)]));
    check("bare zip is NOT allowlisted (real docx sniffs to the docx mime)", ftDocx?.mime === "application/zip", ftDocx?.mime);
  }

  console.log("\n=== Setup ===");
  const prac = await mkUser("practitioner", `SD Prac ${stamp}`);
  const clientUser = await mkUser("client", `SD Client ${stamp}`);
  const outsider = await mkUser("client", `SD Outsider ${stamp}`);

  // Wait for the practitioner_profiles row (created by signup trigger).
  for (let i = 0; i < 20; i++) {
    if ((await db.from("practitioner_profiles").select("id").eq("id", prac.id).maybeSingle()).data) break;
    await new Promise((r) => setTimeout(r, 200));
  }
  await db
    .from("practitioner_profiles")
    .update({ username: `sd${stamp}`, timezone: "Europe/Sofia", bio: "b", headline: "h", location: "Sofia", specialties: ["coaching"], billing_model: "software_provider" })
    .eq("id", prac.id);
  const service = (
    await db
      .from("services")
      .insert({ practitioner_id: prac.id, name: "Consult", duration_minutes: 60, price_cents: 5000, currency: "EUR", is_active: true, delivery_type: "online", delivery_info: "https://meet.example/x" })
      .select("id")
      .single()
  ).data;

  const mkBooking = async (startOffsetMs, status) => {
    const start = new Date(Date.now() + startOffsetMs);
    const end = new Date(start.getTime() + 60 * 60 * 1000);
    const { data, error } = await db
      .from("bookings")
      .insert({ practitioner_id: prac.id, client_id: clientUser.id, service_id: service.id, start_utc: start.toISOString(), end_utc: end.toISOString(), status, delivery_type: "online", service_name: "Consult", price_cents: 5000, currency: "EUR", delivery_info: "https://meet.example/x", documents_enabled: true })
      .select("id")
      .single();
    if (error) throw error;
    return data.id;
  };

  // Active future booking (main RLS/storage tests), spaced well apart from
  // the retention bookings to avoid the no-overlap exclusion constraint.
  const activeBooking = await mkBooking(7 * DAY, "confirmed");
  // Ended 29 days ago → deletion in ~1 day (within the 3-day warn window).
  const expiringBooking = await mkBooking(-29 * DAY, "completed");
  // Ended 31 days ago → past the 30-day retention window.
  const purgeableBooking = await mkBooking(-31 * DAY, "completed");

  console.log("\n=== Storage RLS: own-side write, cross-side denied ===");
  const clientPath = `${activeBooking}/client/${crypto.randomUUID()}.pdf`;
  const up1 = await clientUser.client.storage.from(BUCKET).upload(clientPath, pdfBytes, { contentType: "application/pdf" });
  check("client uploads into their own side", !up1.error, up1.error?.message);

  const crossPath = `${activeBooking}/practitioner/${crypto.randomUUID()}.pdf`;
  const upCross = await clientUser.client.storage.from(BUCKET).upload(crossPath, pdfBytes, { contentType: "application/pdf" });
  check("client CANNOT upload into the practitioner side", !!upCross.error);

  const pracPath = `${activeBooking}/practitioner/${crypto.randomUUID()}.pdf`;
  const up2 = await prac.client.storage.from(BUCKET).upload(pracPath, pdfBytes, { contentType: "application/pdf" });
  check("practitioner uploads into their own side", !up2.error, up2.error?.message);

  console.log("\n=== Storage RLS: reads ===");
  const pracReadsClient = await prac.client.storage.from(BUCKET).createSignedUrl(clientPath, 60);
  check("practitioner can sign a URL for the client's document", !!pracReadsClient.data?.signedUrl);
  const clientReadsPrac = await clientUser.client.storage.from(BUCKET).createSignedUrl(pracPath, 60);
  check("client can sign a URL for the practitioner's document", !!clientReadsPrac.data?.signedUrl);
  const outsiderRead = await outsider.client.storage.from(BUCKET).createSignedUrl(clientPath, 60);
  check("outsider CANNOT sign a URL for a document on a booking they're not in", !outsiderRead.data?.signedUrl);

  console.log("\n=== Metadata table RLS + column grant ===");
  const insOwn = await clientUser.client
    .from("session_documents")
    .insert({ booking_id: activeBooking, side: "client", uploader_id: clientUser.id, file_name: "contract.pdf", byte_size: pdfBytes.length, mime_type: "application/pdf", storage_path: clientPath })
    .select("id, side, file_name")
    .single();
  check("client inserts their own slot metadata", !insOwn.error, insOwn.error?.message);

  const insCross = await clientUser.client
    .from("session_documents")
    .insert({ booking_id: activeBooking, side: "practitioner", uploader_id: clientUser.id, file_name: "x.pdf", byte_size: 10, mime_type: "application/pdf", storage_path: pracPath });
  check("client CANNOT insert practitioner-side metadata", !!insCross.error);

  // practitioner inserts theirs too, so both slots exist.
  await prac.client
    .from("session_documents")
    .insert({ booking_id: activeBooking, side: "practitioner", uploader_id: prac.id, file_name: "summary.pdf", byte_size: pdfBytes.length, mime_type: "application/pdf", storage_path: pracPath });

  const pracSeesClientMeta = await prac.client.from("session_documents").select("side, file_name").eq("booking_id", activeBooking);
  check("practitioner sees BOTH slots' metadata", (pracSeesClientMeta.data ?? []).length === 2, JSON.stringify(pracSeesClientMeta.data));

  const outsiderMeta = await outsider.client.from("session_documents").select("id").eq("booking_id", activeBooking);
  check("outsider sees NO metadata rows (RLS)", (outsiderMeta.data ?? []).length === 0);

  const grabPath = await clientUser.client.from("session_documents").select("storage_path").eq("booking_id", activeBooking);
  const leaked = (grabPath.data ?? []).some((r) => r.storage_path);
  check("storage_path is NOT readable via a plain select (grant-excluded)", grabPath.error != null || !leaked, grabPath.error?.message ?? JSON.stringify(grabPath.data));

  console.log("\n=== get_session_document_path RPC ===");
  const pathAsParty = await prac.client.rpc("get_session_document_path", { p_booking_id: activeBooking, p_side: "client" });
  check("a party gets the path via the definer RPC", pathAsParty.data === clientPath, pathAsParty.data);
  const pathAsOutsider = await outsider.client.rpc("get_session_document_path", { p_booking_id: activeBooking, p_side: "client" });
  check("an outsider gets NULL from the RPC", !pathAsOutsider.data, JSON.stringify(pathAsOutsider.data));

  console.log("\n=== Event log ===");
  const evOwn = await clientUser.client.from("session_document_events").insert({ booking_id: activeBooking, side: "client", actor_id: clientUser.id, action: "uploaded", file_name: "contract.pdf", byte_size: pdfBytes.length, mime_type: "application/pdf" });
  check("party appends their own event", !evOwn.error, evOwn.error?.message);
  const evForge = await clientUser.client.from("session_document_events").insert({ booking_id: activeBooking, side: "practitioner", actor_id: clientUser.id, action: "uploaded" });
  check("party CANNOT forge an event for the other side", !!evForge.error);
  const evRetentionForge = await clientUser.client.from("session_document_events").insert({ booking_id: activeBooking, side: "client", actor_id: clientUser.id, action: "deleted_retention" });
  check("party CANNOT write a 'deleted_retention' (system-only) event", !!evRetentionForge.error);
  const bothSeeEvents = await prac.client.from("session_document_events").select("id").eq("booking_id", activeBooking);
  check("both parties can read the event history", (bothSeeEvents.data ?? []).length >= 1);
  const outsiderEvents = await outsider.client.from("session_document_events").select("id").eq("booking_id", activeBooking);
  check("outsider reads NO events", (outsiderEvents.data ?? []).length === 0);

  console.log("\n=== Retention RPCs (service-role only) ===");
  // Seed metadata + objects for the expiring and purgeable bookings.
  const seed = async (bookingId) => {
    const p = `${bookingId}/client/${crypto.randomUUID()}.pdf`;
    await db.storage.from(BUCKET).upload(p, pdfBytes, { contentType: "application/pdf" });
    await db.from("session_documents").insert({ booking_id: bookingId, side: "client", uploader_id: clientUser.id, file_name: "f.pdf", byte_size: pdfBytes.length, mime_type: "application/pdf", storage_path: p });
    return p;
  };
  const seededPaths = [await seed(expiringBooking), await seed(purgeableBooking)];

  const expFrom = new Date(Date.now() - 30 * DAY).toISOString();
  const expTo = new Date(Date.now() + (3 - 30) * DAY).toISOString();
  const expiring = await db.rpc("get_expiring_session_documents_batch", { end_utc_from: expFrom, end_utc_to: expTo, batch_limit: 100 });
  const expiringIds = (expiring.data ?? []).map((r) => r.booking_id);
  check("expiring RPC returns the 29-days-ago booking", expiringIds.includes(expiringBooking));
  check("expiring RPC does NOT return the still-active booking", !expiringIds.includes(activeBooking));

  const purgeable = await db.rpc("get_purgeable_session_documents", { end_utc_before: new Date(Date.now() - 30 * DAY).toISOString(), batch_limit: 100 });
  const purgeableIds = (purgeable.data ?? []).map((r) => r.booking_id);
  check("purge RPC returns the 31-days-ago booking", purgeableIds.includes(purgeableBooking));
  check("purge RPC does NOT return the 29-days-ago (warn-only) booking", !purgeableIds.includes(expiringBooking));

  const authedPurge = await clientUser.client.rpc("get_purgeable_session_documents", { end_utc_before: new Date().toISOString(), batch_limit: 10 });
  check("authenticated user CANNOT execute the purge RPC", !!authedPurge.error, authedPurge.error?.message);
  const authedExpiring = await clientUser.client.rpc("get_expiring_session_documents_batch", { end_utc_from: expFrom, end_utc_to: expTo, batch_limit: 10 });
  check("authenticated user CANNOT execute the expiring RPC", !!authedExpiring.error, authedExpiring.error?.message);

  console.log("\n=== Storage usage RPC (service-role only) ===");
  const authedUsage = await clientUser.client.rpc("get_storage_usage");
  check("authenticated user CANNOT call get_storage_usage", !!authedUsage.error, authedUsage.error?.message);
  const usage = await db.rpc("get_storage_usage");
  const docBucket = (usage.data ?? []).find((r) => r.bucket_id === BUCKET);
  check("service role reads storage usage incl. session-documents bucket", !!docBucket && Number(docBucket.total_bytes) > 0, JSON.stringify(docBucket));

  console.log("\n=== Cleanup ===");
  for (const b of [activeBooking, expiringBooking, purgeableBooking]) {
    await db.from("session_document_events").delete().eq("booking_id", b);
    await db.from("session_documents").delete().eq("booking_id", b);
    await db.from("bookings").delete().eq("id", b);
  }
  await db.storage.from(BUCKET).remove([clientPath, pracPath, ...seededPaths]);
  for (const id of created) await db.auth.admin.deleteUser(id).catch(() => {});

  console.log(`\n${failures === 0 ? "ALL PASSED" : `${failures} FAILURE(S)`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
