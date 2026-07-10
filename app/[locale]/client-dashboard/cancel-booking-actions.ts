"use server";

import { getLocale } from "next-intl/server";
import { DateTime } from "luxon";
import { redirect } from "@/i18n/navigation";
import { createClient } from "@/lib/supabase/server";

// Bound via .bind(null, bookingId) from the cancel button, not an
// editable form field — but binding isn't a security boundary, a
// direct API call can still send any id it wants. Every check here is
// re-derived server-side and, critically, the notice cutoff is also
// enforced independently by the client-cancel RLS UPDATE policy's
// USING clause (identical comparison) — this app-level check only
// exists to produce a specific, translated message before that policy
// would otherwise just silently affect zero rows.
export async function cancelBookingAsClient(bookingId: string, _formData: FormData) {
  const locale = await getLocale();

  async function redirectWithError(code: string) {
    redirect({ href: { pathname: "/client-dashboard", query: { cancelError: code } }, locale });
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
    .select("start_utc, status, practitioner_id")
    .eq("id", bookingId)
    .eq("client_id", user.id)
    .single();

  if (!booking) {
    await redirectWithError("cancellationFailed");
    return;
  }
  if (booking.status !== "pending" && booking.status !== "confirmed") {
    await redirectWithError("alreadyCancelled");
    return;
  }

  const { data: practitionerProfile } = await supabase
    .from("practitioner_profiles")
    .select("min_notice_hours")
    .eq("id", booking.practitioner_id)
    .single();
  const minNoticeHours = practitionerProfile?.min_notice_hours ?? 24;

  // A duration relative to an instant, not a calendar concept — no
  // timezone resolution needed, same reasoning as generateSlots'
  // identical comparison (see lib/availability/generateSlots.ts).
  const cutoff = DateTime.utc().plus({ hours: minNoticeHours });
  if (DateTime.fromISO(booking.start_utc, { zone: "utc" }) < cutoff) {
    await redirectWithError("tooLateToCancel");
    return;
  }

  const { data: updated, error } = await supabase
    .from("bookings")
    .update({ status: "cancelled_by_client" })
    .eq("id", bookingId)
    .eq("client_id", user.id)
    .select();

  // A zero-row result despite a clean pre-check above means the RLS
  // policy's own (redundant, authoritative) cutoff check rejected it —
  // e.g. a race right at the boundary. Still just a clean generic
  // message, never a raw DB error.
  if (error || !updated || updated.length === 0) {
    if (error) console.error("cancelBookingAsClient failed:", error);
    await redirectWithError("cancellationFailed");
    return;
  }

  redirect({ href: { pathname: "/client-dashboard", query: { cancelled: "1" } }, locale });
}
