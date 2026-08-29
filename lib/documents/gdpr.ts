import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

const BUCKET = "session-documents";

// A session document as it appears in a user's data export. Metadata is
// included for EVERY document on the user's bookings (both sides) — the
// record that an exchange happened is part of their session history. The
// actual file bytes are included in the export ZIP only for documents the
// USER uploaded (their own content); `file` is the path inside the ZIP for
// those, null for the counterparty's (whose file is not the requester's
// personal data to hand out).
export type ExportedSessionDocument = {
  bookingId: string;
  side: string;
  fileName: string;
  byteSize: number;
  mimeType: string;
  uploadedAt: string;
  uploadedByMe: boolean;
  file: string | null;
};

// Strip path separators so a stored display name can't escape the ZIP's
// documents/ folder (defence-in-depth; file_name is already length-bounded).
function safeName(name: string): string {
  return name.replace(/[/\\]/g, "_").slice(0, 200) || "document";
}

// Gathers the session-document metadata for a user's bookings and the list
// of their OWN uploaded files to embed in the export ZIP. Read with the
// service-role client (the export route already uses it) scoped to the
// caller's own booking ids.
export async function collectSessionDocuments(
  admin: SupabaseClient,
  userId: string,
  bookingIds: string[],
): Promise<{ metadata: ExportedSessionDocument[]; files: { zipPath: string; storagePath: string }[] }> {
  if (bookingIds.length === 0) return { metadata: [], files: [] };

  const { data, error } = await admin
    .from("session_documents")
    .select("booking_id, side, file_name, byte_size, mime_type, uploaded_at, uploader_id, storage_path")
    .in("booking_id", bookingIds);
  if (error) {
    console.error("collectSessionDocuments: query failed", { error });
    return { metadata: [], files: [] };
  }

  const metadata: ExportedSessionDocument[] = [];
  const files: { zipPath: string; storagePath: string }[] = [];
  let n = 0;
  for (const row of data ?? []) {
    const uploadedByMe = row.uploader_id === userId;
    let zipPath: string | null = null;
    if (uploadedByMe && row.storage_path) {
      n += 1;
      // Index prefix guarantees uniqueness even if two documents share a name.
      zipPath = `documents/${String(n).padStart(2, "0")}-${safeName(row.file_name)}`;
      files.push({ zipPath, storagePath: row.storage_path });
    }
    metadata.push({
      bookingId: row.booking_id,
      side: row.side,
      fileName: row.file_name,
      byteSize: row.byte_size,
      mimeType: row.mime_type,
      uploadedAt: row.uploaded_at,
      uploadedByMe,
      file: zipPath,
    });
  }
  return { metadata, files };
}

// Account-deletion purge for the documents a user UPLOADED: delete the
// storage objects + metadata rows, and anonymise (null the actor on) their
// entries in the append-only event log. Filename/size/type on the events are
// deliberately KEPT — they're facts about the exchange, and the log exists so
// either party can later establish that something was exchanged; the
// counterparty has a legitimate interest in that evidence surviving.
//
// Documents the COUNTERPARTY uploaded on this user's bookings are NOT touched
// — that's the counterparty's content; it expires via the normal retention
// sweep. Best-effort throughout (logged, never throws): the account is being
// anonymised regardless, and retention is the backstop, so a storage hiccup
// must not strand the deletion.
export async function purgeUploadedDocumentsForUser(svc: SupabaseClient, userId: string): Promise<{ documentsPurged: number }> {
  const { data, error } = await svc.from("session_documents").select("id, storage_path").eq("uploader_id", userId);
  if (error) {
    console.error("purgeUploadedDocumentsForUser: query failed", { userId, error });
    return { documentsPurged: 0 };
  }
  const rows = data ?? [];

  const paths = rows.map((r) => r.storage_path).filter((p): p is string => !!p);
  if (paths.length > 0) {
    const { error: rmError } = await svc.storage.from(BUCKET).remove(paths);
    if (rmError) console.error("purgeUploadedDocumentsForUser: storage remove failed", { userId, rmError });
  }

  if (rows.length > 0) {
    const { error: delError } = await svc.from("session_documents").delete().eq("uploader_id", userId);
    if (delError) console.error("purgeUploadedDocumentsForUser: row delete failed", { userId, delError });
  }

  // Anonymise the actor; keep the exchange facts (file_name/byte_size/mime_type).
  const { error: evError } = await svc.from("session_document_events").update({ actor_id: null }).eq("actor_id", userId);
  if (evError) console.error("purgeUploadedDocumentsForUser: event anonymise failed", { userId, evError });

  return { documentsPurged: rows.length };
}
