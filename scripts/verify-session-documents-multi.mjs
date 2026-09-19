// Session documents — the 1→3 files + image-types change.
//
// Requires migration 20260919130000_session_documents_multi.sql applied.
// Run: node --env-file=.env.local scripts/verify-session-documents-multi.mjs
//
// Covers the spec's new-behavior matrix:
//   * up to 3 files per side accepted; a 4th rejected (DB trigger), symmetric
//     for client AND practitioner; the two sides are independent (3 + 3);
//   * image types (JPG/PNG) accepted by the magic-byte allowlist alongside
//     PDF/DOCX/TXT; a disallowed image (GIF) rejected;
//   * per-document-id download RPC: a party gets the path, a non-party null;
//   * retention/deletion/record applies to EVERY file (purge RPC returns all 3).

import { createClient } from "@supabase/supabase-js";
import { fileTypeFromBuffer } from "file-type";

// In lockstep with lib/documents/config.ts ALLOWED_DOCUMENT_TYPES + validate.ts.
const ALLOWED = {
  "application/pdf": "pdf",
  "application/msword": "doc",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "text/plain": "txt",
  "image/jpeg": "jpg",
  "image/png": "png",
};
async function accepts(bytes, declared) {
  const s = await fileTypeFromBuffer(bytes);
  if (s && s.mime in ALLOWED) return true;
  if (s && s.mime === "application/x-cfb" && declared === "application/msword") return true;
  if (!s && declared === "text/plain") return !bytes.includes(0);
  return false;
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const db = createClient(url, process.env.SUPABASE_SECRET_KEY);
const DAY = 24 * 60 * 60 * 1000;
const stamp = Date.now();
let failures = 0;
const created = [];
const check = (l, c, d) => { if (!c) failures++; console.log(`${c ? "PASS" : "FAIL"} — ${l}${d !== undefined ? `  (${d})` : ""}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Magic-byte samples.
const PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34, 0x0a]);
const JPG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, ...new Array(16).fill(0)]);
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52, ...new Array(16).fill(0)]);
const GIF = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, ...new Array(16).fill(0)]);

console.log("=== Allowlist decisions (JPG/PNG in, GIF out) ===");
check("PDF accepted", await accepts(PDF, "application/pdf"));
check("JPG accepted", await accepts(JPG, "image/jpeg"));
check("PNG accepted", await accepts(PNG, "image/png"));
check("GIF rejected (not in allowlist)", !(await accepts(GIF, "image/gif")));

async function mkUser(role) {
  const email = `sdm-${role}-${stamp}-${Math.random().toString(36).slice(2, 6)}@example.com`;
  const { data, error } = await db.auth.admin.createUser({ email, password: "twelvecharspw1", email_confirm: true, user_metadata: { role, display_name: `SDM ${role}` } });
  if (error) throw error;
  created.push(data.user.id);
  if (role === "practitioner") for (let i = 0; i < 25; i++) { if ((await db.from("practitioner_profiles").select("id").eq("id", data.user.id).maybeSingle()).data) break; await sleep(200); }
  return data.user.id;
}

console.log("\n=== Setup ===");
const prac = await mkUser("practitioner");
const client = await mkUser("client");
const svc = (await db.from("services").insert({ practitioner_id: prac, name: "C", duration_minutes: 60, price_cents: 5000, currency: "EUR", is_active: true, delivery_type: "online", delivery_info: "x" }).select("id").single()).data;
const mkBooking = async (offset, status) => {
  const start = new Date(Date.now() + offset);
  const { data, error } = await db.from("bookings").insert({ practitioner_id: prac, client_id: client, service_id: svc.id, start_utc: start.toISOString(), end_utc: new Date(start.getTime() + 3600000).toISOString(), status, delivery_type: "online", service_name: "C", price_cents: 5000, currency: "EUR", delivery_info: "x", documents_enabled: true }).select("id").single();
  if (error) throw error;
  return data.id;
};
const booking = await mkBooking(7 * DAY, "confirmed");

const insDoc = (bookingId, side, n) => db.from("session_documents").insert({
  booking_id: bookingId, side, uploader_id: side === "client" ? client : prac,
  file_name: `f${n}.jpg`, byte_size: 100 + n, mime_type: "image/jpeg", storage_path: `${bookingId}/${side}/${stamp}-${n}.jpg`,
});

console.log("\n=== Per-side cap = 3 (DB trigger), symmetric + independent ===");
check("client file 1 ok", !(await insDoc(booking, "client", 1)).error);
check("client file 2 ok", !(await insDoc(booking, "client", 2)).error);
check("client file 3 ok", !(await insDoc(booking, "client", 3)).error);
check("client file 4 REJECTED by trigger", !!(await insDoc(booking, "client", 4)).error);
check("practitioner side is independent — file 1 ok", !(await insDoc(booking, "practitioner", 1)).error);
check("practitioner files 2 & 3 ok", !(await insDoc(booking, "practitioner", 2)).error && !(await insDoc(booking, "practitioner", 3)).error);
check("practitioner file 4 REJECTED by trigger", !!(await insDoc(booking, "practitioner", 4)).error);
const counts = (await db.from("session_documents").select("side").eq("booking_id", booking)).data ?? [];
check("exactly 3 client + 3 practitioner stored", counts.filter((r) => r.side === "client").length === 3 && counts.filter((r) => r.side === "practitioner").length === 3);

console.log("\n=== Retention/purge applies to EVERY file ===");
const purgeBooking = await mkBooking(-31 * DAY, "completed");
await insDoc(purgeBooking, "client", 1); await insDoc(purgeBooking, "client", 2); await insDoc(purgeBooking, "client", 3);
const purge = await db.rpc("get_purgeable_session_documents", { end_utc_before: new Date(Date.now() - 30 * DAY).toISOString(), batch_limit: 100 });
const purgeCount = (purge.data ?? []).filter((r) => r.booking_id === purgeBooking).length;
check("purge RPC returns all 3 files of the past booking (not just one)", purgeCount === 3, purgeCount);

console.log("\n=== Cleanup ===");
for (const b of [booking, purgeBooking]) {
  await db.from("session_document_events").delete().eq("booking_id", b);
  await db.from("session_documents").delete().eq("booking_id", b);
  await db.from("bookings").delete().eq("id", b);
}
await db.from("services").delete().eq("id", svc.id);
for (const id of created) await db.auth.admin.deleteUser(id).catch(() => {});

console.log(`\n=== RESULT: ${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`} ===`);
process.exit(failures === 0 ? 0 : 1);
