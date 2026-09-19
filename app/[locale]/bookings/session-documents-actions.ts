"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { getTranslations } from "next-intl/server";
import { createClient } from "@/lib/supabase/server";
import { isEnabled } from "@/lib/flags";
import { checkRateLimit, documentUploadLimiter } from "@/lib/rate-limit";
import { validateDocumentBytes } from "@/lib/documents/validate";
import { SESSION_DOCUMENT_MAX_BYTES, SESSION_DOCUMENT_MAX_FILES_PER_SIDE, SESSION_DOCUMENT_RETENTION_DAYS } from "@/lib/documents/config";

const BUCKET = "session-documents";
const SIGNED_URL_TTL_SECONDS = 60;
const DAY_MS = 24 * 60 * 60 * 1000;

export type DocumentActionState = { error?: string; success?: boolean } | null;

type Side = "client" | "practitioner";

function parseSide(value: FormDataEntryValue | null): Side | null {
  return value === "client" || value === "practitioner" ? value : null;
}

// Both dashboards render the booking-details disclosure, so a change on
// either side must refresh both surfaces. Layout-type revalidation, same
// as the practitioner dashboard's own actions — the bookings views live
// under a shared layout.
function revalidateBookingViews() {
  revalidatePath("/practitioner-dashboard", "layout");
  revalidatePath("/client-dashboard", "layout");
}

// Loads the booking (RLS already restricts this to rows where the caller
// is a party) and confirms the caller owns THIS side. Also enforces the
// upload window: a file may be added any time up to the retention deletion
// date (end_utc + RETENTION_DAYS), regardless of the booking's status — a
// contract before, a summary after. Past that date the slot is purged and
// locked.
async function authorizeSide(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  bookingId: string,
  side: Side,
): Promise<{ ok: true; expired: boolean } | { ok: false }> {
  const { data: booking } = await supabase
    .from("bookings")
    .select("id, client_id, practitioner_id, end_utc, documents_enabled")
    .eq("id", bookingId)
    .maybeSingle();
  if (!booking) return { ok: false };

  // The per-service setting, frozen on the booking. Enforced HERE, not
  // only in the UI: a stale form or forged request can't write to a
  // booking whose service never offered file exchange.
  if (!booking.documents_enabled) return { ok: false };

  const ownsSide =
    (side === "client" && booking.client_id === userId) ||
    (side === "practitioner" && booking.practitioner_id === userId);
  if (!ownsSide) return { ok: false };

  const deletionDate = new Date(new Date(booking.end_utc).getTime() + SESSION_DOCUMENT_RETENTION_DAYS * DAY_MS);
  return { ok: true, expired: Date.now() > deletionDate.getTime() };
}

// The path for a single file via the narrow definer RPC — the only route to
// storage_path, grant-excluded from every direct query. Returns null when the
// document doesn't exist or the caller isn't a party.
async function pathById(
  supabase: Awaited<ReturnType<typeof createClient>>,
  documentId: string,
): Promise<string | null> {
  const { data } = await supabase.rpc("get_session_document_path", { p_document_id: documentId });
  return (data as string | null) ?? null;
}

export async function uploadSessionDocument(
  _prev: DocumentActionState,
  formData: FormData,
): Promise<DocumentActionState> {
  const t = await getTranslations("SessionDocuments");
  if (!(await isEnabled("sessionDocuments"))) return { error: t("unavailable") };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: t("notLoggedIn") };

  const bookingId = String(formData.get("bookingId") ?? "");
  const side = parseSide(formData.get("side"));
  if (!bookingId || !side) return { error: t("notAllowed") };

  const rate = await checkRateLimit(documentUploadLimiter, `${user.id}:${bookingId}`);
  if (!rate.success) return { error: t("rateLimited") };

  const auth = await authorizeSide(supabase, user.id, bookingId, side);
  if (!auth.ok) return { error: t("notAllowed") };
  if (auth.expired) return { error: t("expired") };

  // Per-side cap. App-side check for a clean message; the DB trigger
  // (migration 20260919130000) is the authoritative backstop against a race.
  const { count } = await supabase
    .from("session_documents")
    .select("id", { count: "exact", head: true })
    .eq("booking_id", bookingId)
    .eq("side", side);
  if ((count ?? 0) >= SESSION_DOCUMENT_MAX_FILES_PER_SIDE) {
    return { error: t("limitReached", { max: SESSION_DOCUMENT_MAX_FILES_PER_SIDE }) };
  }

  const entry = formData.get("file");
  const file = entry instanceof File && entry.size > 0 ? entry : null;
  if (!file) return { error: t("fileRequired") };
  if (file.size > SESSION_DOCUMENT_MAX_BYTES) {
    return { error: t("tooLarge", { max: Math.round(SESSION_DOCUMENT_MAX_BYTES / (1024 * 1024)) }) };
  }

  // Read the actual bytes and validate the magic number — never trust the
  // declared extension/Content-Type for a file another user will open.
  const bytes = new Uint8Array(await file.arrayBuffer());
  const validation = await validateDocumentBytes(bytes, file.type);
  if (!validation.ok) return { error: t("invalidType") };

  // Unguessable, non-enumerable, self-describing enough for the storage RLS
  // insert check ({booking_id}/{side}/...). One object per row; adding a file
  // is always a fresh INSERT now (no replace/swap — remove + add instead).
  const newPath = `${bookingId}/${side}/${randomUUID()}.${validation.ext}`;

  const { error: uploadError } = await supabase.storage
    .from(BUCKET)
    .upload(newPath, bytes, { contentType: validation.mime, upsert: false });
  if (uploadError) {
    console.error("uploadSessionDocument: storage upload failed", { bookingId, side, error: uploadError });
    return { error: t("uploadFailed") };
  }

  // No .select() — return=minimal, so nothing tries to read storage_path back
  // through the grant that excludes it. The DB trigger may reject this insert
  // if a racing upload already filled the last slot; roll back the object then.
  const { error: rowError } = await supabase.from("session_documents").insert({
    booking_id: bookingId,
    side,
    uploader_id: user.id,
    file_name: file.name.slice(0, 255),
    byte_size: file.size,
    mime_type: validation.mime,
    storage_path: newPath,
    uploaded_at: new Date().toISOString(),
  });

  if (rowError) {
    await supabase.storage.from(BUCKET).remove([newPath]).catch(() => {});
    // A trigger-rejected insert (the per-side cap raced) reads as the limit
    // message; anything else is a generic save failure.
    const limitHit = rowError.message?.includes("session_document_limit_reached");
    console.error("uploadSessionDocument: metadata insert failed", { bookingId, side, error: rowError });
    return { error: limitHit ? t("limitReached", { max: SESSION_DOCUMENT_MAX_FILES_PER_SIDE }) : t("saveFailed") };
  }

  // Append to the audit log (survives the file). Best-effort.
  const { error: eventError } = await supabase.from("session_document_events").insert({
    booking_id: bookingId,
    side,
    actor_id: user.id,
    action: "uploaded",
    file_name: file.name.slice(0, 255),
    byte_size: file.size,
    mime_type: validation.mime,
  });
  if (eventError) console.error("uploadSessionDocument: event log insert failed", { bookingId, side, error: eventError });

  revalidateBookingViews();
  return { success: true };
}

export async function removeSessionDocument(
  _prev: DocumentActionState,
  formData: FormData,
): Promise<DocumentActionState> {
  const t = await getTranslations("SessionDocuments");
  if (!(await isEnabled("sessionDocuments"))) return { error: t("unavailable") };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: t("notLoggedIn") };

  const documentId = String(formData.get("documentId") ?? "");
  if (!documentId) return { error: t("notAllowed") };

  // The row's side/booking (RLS lets a party read it) — needed to confirm the
  // caller owns THIS side and to log the event.
  const { data: doc } = await supabase
    .from("session_documents")
    .select("id, booking_id, side")
    .eq("id", documentId)
    .maybeSingle();
  if (!doc) return { error: t("notAllowed") };

  const side = doc.side as Side;
  const auth = await authorizeSide(supabase, user.id, doc.booking_id, side);
  if (!auth.ok) return { error: t("notAllowed") };

  const path = await pathById(supabase, documentId);

  // RLS restricts this DELETE to the caller's own side; authorizeSide has
  // already confirmed that, so this removes exactly the one row.
  const { error: deleteError } = await supabase.from("session_documents").delete().eq("id", documentId);
  if (deleteError) {
    console.error("removeSessionDocument: row delete failed", { documentId, error: deleteError });
    return { error: t("saveFailed") };
  }

  if (path) {
    await supabase.storage.from(BUCKET).remove([path]).catch((err) => {
      console.error("removeSessionDocument: storage remove failed", { path, err });
    });
  }

  const { error: eventError } = await supabase.from("session_document_events").insert({
    booking_id: doc.booking_id,
    side,
    actor_id: user.id,
    action: "deleted_by_user",
  });
  if (eventError) console.error("removeSessionDocument: event log insert failed", { documentId, error: eventError });

  revalidateBookingViews();
  return { success: true };
}

// Called on demand from the client (a download click), not a form action:
// mints a short-lived signed URL for one file and returns ONLY the URL — the
// raw storage path never reaches the browser. Either party may download either
// side's files.
export async function getSessionDocumentUrl(documentId: string): Promise<{ url: string | null; error?: string }> {
  if (!(await isEnabled("sessionDocuments"))) return { url: null, error: "unavailable" };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { url: null, error: "unauthenticated" };

  const path = await pathById(supabase, documentId);
  if (!path) return { url: null };

  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, SIGNED_URL_TTL_SECONDS);
  if (error || !data) {
    console.error("getSessionDocumentUrl: createSignedUrl failed", { documentId, error });
    return { url: null, error: "failed" };
  }
  return { url: data.signedUrl };
}
