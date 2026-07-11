"use server";

import { getLocale } from "next-intl/server";
import { redirect } from "@/i18n/navigation";
import { createClient } from "@/lib/supabase/server";
import { checkRateLimit, bookingLimiter } from "@/lib/rate-limit";
import { getBookableSlots } from "@/lib/availability/slots";
import { sendBookingConfirmationEmails, normalizeLocale } from "@/lib/email";

// Bound via .bind() from the button, not editable form fields — but
// binding isn't a security boundary, a direct API call can still send
// any arguments it wants. Every value here is re-derived/re-validated
// from scratch below before anything is written; nothing is trusted
// just because it arrived via a bound action. clientTimezone is the
// one exception to "never trust a bound value": it's not used for any
// access-control or booking-correctness decision, only for how the
// confirmation email displays the session time to this client — a
// forged value there just makes their own email display wrong, not a
// security concern.
export async function bookSlot(
  practitionerId: string,
  serviceId: string,
  username: string,
  startUtc: string,
  clientTimezone: string,
  _formData: FormData,
) {
  const locale = await getLocale();

  async function redirectWithError(code: string) {
    redirect({
      href: { pathname: `/p/${username}`, query: { service: serviceId, bookingError: code } },
      locale,
    });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect({ href: "/login", locale });
    return;
  }

  // Keyed by user id, not IP — booking already requires auth, so this is
  // a more precise identifier than IP for bounding one account
  // spam-booking a practitioner's calendar.
  const { success } = await checkRateLimit(bookingLimiter, user.id);
  if (!success) {
    await redirectWithError("rateLimited");
    return;
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  if (profile?.role !== "client") {
    await redirectWithError("onlyClientsCanBook");
    return;
  }

  // Real duration always comes from this row, scoped to the practitioner
  // and active-only — never trusted from any client-supplied value.
  const { data: service } = await supabase
    .from("services")
    .select("duration_minutes")
    .eq("id", serviceId)
    .eq("practitioner_id", practitionerId)
    .eq("is_active", true)
    .single();

  if (!service) {
    await redirectWithError("slotNoLongerAvailable");
    return;
  }

  // The actual re-validation: re-run the exact same slot-generation slice
  // 1 already built, and confirm the requested instant is genuinely
  // still offered. A forged, off-grid, past, or already-booked startUtc
  // simply won't appear here.
  const freshSlots = await getBookableSlots({ practitionerId, serviceId });
  const isValidSlot = freshSlots.some((slot) => slot.startUtc === startUtc);
  if (!isValidSlot) {
    await redirectWithError("slotNoLongerAvailable");
    return;
  }

  const endUtc = new Date(
    new Date(startUtc).getTime() + service.duration_minutes * 60 * 1000,
  ).toISOString();

  const { data: booking, error } = await supabase
    .from("bookings")
    .insert({
      practitioner_id: practitionerId,
      client_id: user.id,
      service_id: serviceId,
      start_utc: startUtc,
      end_utc: endUtc,
    })
    .select("id")
    .single();

  if (error) {
    // 23P01 = exclusion_violation — the race case: this slot passed
    // re-validation above but a concurrent request won it in the tiny
    // window between that check and this insert. This is exactly what
    // the DB-level exclusion constraint exists to catch; the app-level
    // check above closes the much larger "forged/stale slot" case, this
    // closes the true concurrency race.
    if (error.code === "23P01") {
      await redirectWithError("slotTaken");
      return;
    }
    console.error("bookSlot failed:", error);
    await redirectWithError("bookingFailed");
    return;
  }

  // Best-effort refresh of this client's saved timezone — own row,
  // covered by the same update policy/grant as display_name. A failure
  // here doesn't block the booking; it just means their next email
  // falls back to an older (or absent) saved value.
  const { error: timezoneError } = await supabase
    .from("profiles")
    .update({ timezone: clientTimezone })
    .eq("id", user.id);
  if (timezoneError) {
    console.error("bookSlot: failed to refresh profiles.timezone:", timezoneError);
  }

  // Sending happens after the booking is already committed — a failed
  // email must never fail or roll back the booking. sendBookingConfirmationEmails
  // never throws (see lib/email); still awaited, not fire-and-forget,
  // so the attempt genuinely completes before this serverless
  // invocation's response is sent.
  await sendBookingConfirmationEmails(booking.id, normalizeLocale(locale));

  redirect({
    href: { pathname: `/p/${username}`, query: { service: serviceId, booked: "1" } },
    locale,
  });
}
