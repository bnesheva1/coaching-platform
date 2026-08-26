"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { getTranslations } from "next-intl/server";
import { createClient } from "@/lib/supabase/server";
import { isEnabled } from "@/lib/flags";
import { checkRateLimit, documentUploadLimiter } from "@/lib/rate-limit";
import { validateDocumentBytes } from "@/lib/documents/validate";
import { SESSION_DOCUMENT_MAX_BYTES, SESSION_DOCUMENT_RETENTION_DAYS } from "@/lib/documents/config";

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
// upload window: a document may be added/replaced any time up to the
// retention deletion date (end_utc + RETENTION_DAYS), regardless of the
// booking's status — a contract before, a summary after. Past that date
// the slot is purged and locked.
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

// Fetches the current stored object path for a slot via the narrow
// definer RPC — the only route to storage_path, which is grant-excluded
// from every direct query. Returns null for an empty/purged slot.
async function currentPath(
  supabase: Awaited<ReturnType<typeof createClient>>,
  bookingId: string,
  side: Side,
): Promise<string | null> {
  const { data } = await supabase.rpc("get_session_document_path", { p_booking_id: bookingId, p_side: side });
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

  const entry = formData.get("file");
  const file = entry instanceof File && entry.size > 0 ? entry : null;
  if (!file) return { error: t("fileRequired") };
  if (file.size > SESSION_DOCUMENT_MAX_BYTES) return { error: t("tooLarge") };

  // Read the actual bytes and validate the magic number — never trust the
  // declared extension/Content-Type for a file another user will open.
  const bytes = new Uint8Array(await file.arrayBuffer());
  const validation = await validateDocumentBytes(bytes, file.type);
  if (!validation.ok) return { error: t("invalidType") };

  // A replacement is an outright swap: keep the old path so we can delete
  // it after the new one is safely stored (no versioning — one slot, one
  // document).
  const oldPath = await currentPath(supabase, bookingId, side);

  // Unguessable, non-enumerable, and self-describing enough for the
  // storage RLS insert check ({booking_id}/{side}/...). A fresh token per
  // upload means the signed URL changes on replace with no cache-busting.
  const newPath = `${bookingId}/${side}/${randomUUID()}.${validation.ext}`;

  const { error: uploadError } = await supabase.storage
    .from(BUCKET)
    .upload(newPath, bytes, { contentType: validation.mime, upsert: false });
  if (uploadError) {
    console.error("uploadSessionDocument: storage upload failed", { bookingId, side, error: uploadError });
    return { error: t("uploadFailed") };
  }

  // Insert-or-update explicitly rather than upsert: `INSERT ... ON CONFLICT
  // DO UPDATE` requires wider table SELECT privilege than our column grant
  // allows (which deliberately excludes storage_path), so an upsert is
  // rejected outright. A row exists iff there's a current path (both the
  // user-remove and the retention purge DELETE the row, never leave a
  // null-path row), so oldPath is a reliable "is this a replacement?" flag.
  // No .select() on either — return=minimal, so nothing tries to read
  // storage_path back.
  const nowIso = new Date().toISOString();
  const { error: rowError } = oldPath
    ? await supabase
        .from("session_documents")
        .update({
          uploader_id: user.id,
          file_name: file.name.slice(0, 255),
          byte_size: file.size,
          mime_type: validation.mime,
          storage_path: newPath,
          uploaded_at: nowIso,
          // A new file restarts the retention warning cycle.
          retention_warned_at: null,
        })
        .eq("booking_id", bookingId)
        .eq("side", side)
    : await supabase.from("session_documents").insert({
        booking_id: bookingId,
        side,
        uploader_id: user.id,
        file_name: file.name.slice(0, 255),
        byte_size: file.size,
        mime_type: validation.mime,
        storage_path: newPath,
        uploaded_at: nowIso,
      });

  if (rowError) {
    // Metadata write failed — roll back the just-uploaded object so we
    // don't leak an orphan the record doesn't know about.
    await supabase.storage.from(BUCKET).remove([newPath]).catch(() => {});
    console.error("uploadSessionDocument: metadata upsert failed", { bookingId, side, error: rowError });
    return { error: t("saveFailed") };
  }

  // New object stored and recorded — now best-effort delete the replaced
  // one. An orphaned old object is a far smaller problem than failing a
  // succeeded upload, and the retention sweep is a backstop.
  if (oldPath && oldPath !== newPath) {
    await supabase.storage.from(BUCKET).remove([oldPath]).catch((err) => {
      console.error("uploadSessionDocument: failed to remove replaced object", { oldPath, err });
    });
  }

  // Append to the audit log (survives the file). Best-effort: the file is
  // already stored, so a log hiccup must not fail the user's upload.
  const { error: eventError } = await supabase.from("session_document_events").insert({
    booking_id: bookingId,
    side,
    actor_id: user.id,
    action: oldPath ? "replaced" : "uploaded",
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

  const bookingId = String(formData.get("bookingId") ?? "");
  const side = parseSide(formData.get("side"));
  if (!bookingId || !side) return { error: t("notAllowed") };

  const auth = await authorizeSide(supabase, user.id, bookingId, side);
  if (!auth.ok) return { error: t("notAllowed") };

  const path = await currentPath(supabase, bookingId, side);

  // Delete the live slot first (RLS restricts this to the caller's own
  // side); the row going is what empties the slot for the UI.
  const { error: deleteError } = await supabase
    .from("session_documents")
    .delete()
    .eq("booking_id", bookingId)
    .eq("side", side);
  if (deleteError) {
    console.error("removeSessionDocument: row delete failed", { bookingId, side, error: deleteError });
    return { error: t("saveFailed") };
  }

  if (path) {
    await supabase.storage.from(BUCKET).remove([path]).catch((err) => {
      console.error("removeSessionDocument: storage remove failed", { path, err });
    });
  }

  const { error: eventError } = await supabase.from("session_document_events").insert({
    booking_id: bookingId,
    side,
    actor_id: user.id,
    action: "deleted_by_user",
  });
  if (eventError) console.error("removeSessionDocument: event log insert failed", { bookingId, side, error: eventError });

  revalidateBookingViews();
  return { success: true };
}

// Called on demand from the client (a download click), not a form
// action: mints a short-lived signed URL and returns ONLY the URL — the
// raw storage path never reaches the browser. Either party may download
// either side's document.
export async function getSessionDocumentUrl(
  bookingId: string,
  side: Side,
): Promise<{ url: string | null; error?: string }> {
  if (!(await isEnabled("sessionDocuments"))) return { url: null, error: "unavailable" };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { url: null, error: "unauthenticated" };

  const path = await currentPath(supabase, bookingId, side);
  if (!path) return { url: null };

  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, SIGNED_URL_TTL_SECONDS);
  if (error || !data) {
    console.error("getSessionDocumentUrl: createSignedUrl failed", { bookingId, side, error });
    return { url: null, error: "failed" };
  }
  return { url: data.signedUrl };
}
