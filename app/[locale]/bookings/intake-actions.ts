"use server";

import { revalidatePath } from "next/cache";
import { getTranslations } from "next-intl/server";
import { createClient } from "@/lib/supabase/server";
import { checkRateLimit, documentUploadLimiter } from "@/lib/rate-limit";
import { sanitizeIntakeText } from "@/lib/text/intakeText";
import { SESSION_DOCUMENT_RETENTION_DAYS } from "@/lib/documents/config";

const DAY_MS = 24 * 60 * 60 * 1000;

export type IntakeActionState = { error?: string; success?: boolean } | null;

// Both dashboards render the booking-details disclosure, so a change must
// refresh both surfaces — same layout-type revalidation as the session-document
// actions.
function revalidateBookingViews() {
  revalidatePath("/practitioner-dashboard", "layout");
  revalidatePath("/client-dashboard", "layout");
}

// The client saves/clears their answer to the service's intake question. It is
// never mandatory, and stays editable throughout the active window (up to
// end_utc + retention, like the file exchange) so it can still be filled in
// during the call. The authoritative gate is the SECURITY DEFINER RPC
// set_booking_intake_answer (checks caller = the booking's client, feature-on,
// window, length); the checks here just produce specific messages first.
export async function saveBookingIntakeAnswer(
  _prev: IntakeActionState,
  formData: FormData,
): Promise<IntakeActionState> {
  const t = await getTranslations("Intake");
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: t("notLoggedIn") };

  const bookingId = String(formData.get("bookingId") ?? "");
  if (!bookingId) return { error: t("notAllowed") };

  const rate = await checkRateLimit(documentUploadLimiter, `${user.id}:${bookingId}`);
  if (!rate.success) return { error: t("rateLimited") };

  // RLS restricts this select to the caller's own bookings; the RPC re-checks
  // ownership regardless.
  const { data: booking } = await supabase
    .from("bookings")
    .select("client_id, end_utc, intake_prompt")
    .eq("id", bookingId)
    .maybeSingle();

  if (!booking || booking.client_id !== user.id || !booking.intake_prompt) {
    return { error: t("notAllowed") };
  }
  const deletionMs = new Date(booking.end_utc).getTime() + SESSION_DOCUMENT_RETENTION_DAYS * DAY_MS;
  if (Date.now() > deletionMs) return { error: t("expired") };

  const answer = sanitizeIntakeText(formData.get("answer") as string | null);

  const { data: ok, error } = await supabase.rpc("set_booking_intake_answer", {
    p_booking_id: bookingId,
    p_answer: answer,
  });
  if (error || ok !== true) {
    console.error("saveBookingIntakeAnswer: RPC failed", { bookingId, error, ok });
    return { error: t("saveFailed") };
  }

  revalidateBookingViews();
  return { success: true };
}
