"use server";

import { revalidatePath } from "next/cache";
import { getLocale } from "next-intl/server";
import { redirect } from "@/i18n/navigation";
import { createClient } from "@/lib/supabase/server";
import { sendCancellationNoticeEmail } from "@/lib/email";

// Mirrors the textarea's own maxLength in CancelSessionDialog.tsx — the
// browser constraint is just UX, this is what actually bounds what ends
// up in an email.
const MAX_NOTE_LENGTH = 500;

// No notice-cutoff check here, deliberately — a practitioner can cancel
// any of their own UPCOMING bookings at any time, including within the
// client's notice window (emergencies happen). The one floor that does
// exist is start_utc itself: a session that has already happened isn't
// "cancellable" anymore, just history — enforced below (for a clean,
// specific error) and, as the real guarantee, by the practitioner-
// cancel RLS UPDATE policy's own start_utc >= now() clause (see
// 20260722100000_practitioner_cannot_cancel_past_bookings.sql).
export async function cancelBookingAsPractitioner(bookingId: string, formData: FormData) {
  const rawNote = (formData.get("note") as string | null)?.trim();
  const note = rawNote ? rawNote.slice(0, MAX_NOTE_LENGTH) : undefined;

  const locale = await getLocale();

  async function redirectWithError(code: string) {
    redirect({ href: { pathname: "/practitioner-dashboard/bookings", query: { cancelError: code } }, locale });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect({ href: "/login", locale });
    return;
  }

  const { data: booking } = await supabase
    .from("bookings")
    .select("start_utc")
    .eq("id", bookingId)
    .eq("practitioner_id", user.id)
    .single();

  if (!booking) {
    await redirectWithError("cancellationFailed");
    return;
  }
  if (new Date(booking.start_utc).getTime() < Date.now()) {
    await redirectWithError("sessionAlreadyPast");
    return;
  }

  const { data: updated, error } = await supabase
    .from("bookings")
    .update({ status: "cancelled_by_practitioner" })
    .eq("id", bookingId)
    .eq("practitioner_id", user.id)
    .select();

  if (error || !updated || updated.length === 0) {
    if (error) console.error("cancelBookingAsPractitioner failed:", error);
    await redirectWithError("cancellationFailed");
    return;
  }

  // Notifies the client (the counterparty) — never fails or blocks the
  // cancellation that already succeeded above.
  await sendCancellationNoticeEmail(bookingId, "practitioner", note);

  // "layout" — the shared layout's sidebar pulse card (this week's
  // session count) reads bookings too; without this it would keep
  // showing the pre-cancellation count until a hard refresh, since a
  // redirect() navigation reuses the already-rendered layout segment
  // rather than re-fetching it.
  revalidatePath("/practitioner-dashboard", "layout");

  redirect({ href: { pathname: "/practitioner-dashboard/bookings", query: { cancelled: "1" } }, locale });
}
