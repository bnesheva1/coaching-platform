"use server";

import { redirect as redirectExternal } from "next/navigation";
import { getLocale } from "next-intl/server";
import { redirect } from "@/i18n/navigation";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/serviceRole";
import { checkRateLimit, bookingLimiter } from "@/lib/rate-limit";
import { getBookableSlots } from "@/lib/availability/slots";
import { sendBookingConfirmationEmails, normalizeLocale } from "@/lib/email";
import { initiateBookingPayment } from "@/lib/payments";
import { ensureVideoSession, videoCapacityAvailable } from "@/lib/video";
import { isEnabled } from "@/lib/flags";
import { siteOrigin } from "@/lib/siteOrigin";

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
//
// Epic 9: this no longer always inserts a booking. It hands off to
// lib/payments' initiateBookingPayment, which decides — based on the
// practitioner's own billing_model, never anything this function
// knows about — whether to redirect to a Stripe Checkout page (nothing
// booked yet; see lib/payments/stripe/webhook.ts for where the booking
// actually gets created) or to book immediately, exactly like every
// booking before this epic existed.
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

  // Admin kill switch: new bookings paused (emergency stop). Checked after
  // auth/role so it's a clean "we're not taking bookings right now" for a
  // real client, and BEFORE any slot/capacity/payment work. Existing bookings
  // are entirely untouched — this only refuses to create new ones.
  if (!(await isEnabled("newBookings"))) {
    await redirectWithError("bookingsPaused");
    return;
  }

  // Per-practitioner controls, enforced server-side (not merely hidden from a
  // button): a frozen or suspended practitioner is not bookable. This reuses
  // the SINGLE bookable derivation (practitioner_bookable_flags, which now folds
  // in moderation_status) rather than a competing check — so it also correctly
  // refuses a practitioner who became unbookable for any other reason between
  // page render and this click. A HIDDEN practitioner stays bookable here (by
  // design: bookable-by-URL), since hidden doesn't affect is_bookable.
  const { data: practitionerBookable } = await supabase.rpc("is_practitioner_bookable", {
    target_practitioner_id: practitionerId,
  });
  if (!practitionerBookable) {
    await redirectWithError("practitionerUnavailable");
    return;
  }

  // Service-role, not the client's own session — phone_number/
  // meeting_link are excluded from the general column grant (same
  // sensitivity as delivery_info), so a client's own RLS-scoped select
  // can't read them directly. This fetch never returns raw to the
  // client though: it's read once, server-side, purely to snapshot
  // those 3 fields onto the new booking row below — the same trusted-
  // internal-read pattern confirm_paid_booking already uses for the
  // Stripe path. .eq() filters here are ordinary query scoping, not an
  // access-control boundary (service-role bypasses RLS entirely).
  const { data: service } = await createServiceRoleClient()
    .from("services")
    .select("name, duration_minutes, price_cents, currency, delivery_type, phone_number, meeting_link, delivery_info")
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

  // Online sessions draw on shared video capacity. Check BEFORE handing
  // off to payment, so a commission-model client is never sent to Stripe
  // Checkout for a session we can't host — and a software_provider client
  // never books one either. Soft cap by design (see lib/video); this same
  // check covers both paths because both flow through here before the
  // paths diverge. endUtc mirrors the booking's own duration.
  if (service.delivery_type === "online") {
    // Admin kill switch: online sessions paused (or the cost breaker fired).
    // Gates only NEW online bookings — no new room will ever be needed.
    // Already-booked sessions are never touched: their rooms are created lazily
    // on join (ensureProviderRoom), which is deliberately NOT gated, so a
    // client with a paid session can always get in. This is why the switch is
    // enforced here at booking time, not at room creation.
    if (!(await isEnabled("video"))) {
      await redirectWithError("videoUnavailable");
      return;
    }
    const endUtc = new Date(new Date(startUtc).getTime() + service.duration_minutes * 60 * 1000).toISOString();
    if (!(await videoCapacityAvailable(startUtc, endUtc))) {
      await redirectWithError("videoCapacityReached");
      return;
    }
  }

  const origin = await siteOrigin();
  const profilePath = `/${locale}/p/${username}`;

  const paymentResult = await initiateBookingPayment({
    practitionerId,
    clientId: user.id,
    serviceId,
    startUtc,
    serviceName: service.name,
    priceCents: service.price_cents,
    currency: service.currency,
    successPath: `${origin}${profilePath}?service=${serviceId}&payment=processing`,
    cancelPath: `${origin}${profilePath}?service=${serviceId}&payment=cancelled`,
  });

  if (paymentResult.type === "redirect") {
    // Best-effort refresh of this client's saved timezone before
    // leaving the app — same reasoning as below, just moved earlier
    // since there's no "after the booking succeeds" moment on this path
    // (the booking doesn't exist yet; it's created by the webhook once
    // Stripe confirms payment).
    await supabase.from("profiles").update({ timezone: clientTimezone }).eq("id", user.id);
    redirectExternal(paymentResult.url);
    return;
  }

  if (paymentResult.type === "error") {
    // Already logged inside initiateBookingPayment — this is purely the
    // client-facing side of that failure. Explicit, not a fallthrough:
    // without this branch, an error result would silently continue into
    // the software_provider path below and insert a booking with no
    // payment ever collected for a commission-model practitioner.
    await redirectWithError("bookingFailed");
    return;
  }

  if (paymentResult.type === "payments_disabled") {
    // The checkout kill switch is off — payments are deliberately paused.
    // Nothing failed and nothing was booked; the client sees an honest
    // "temporarily paused" message rather than a generic error.
    await redirectWithError("checkoutPaused");
    return;
  }

  if (paymentResult.type === "practitioner_not_ready") {
    // Distinct from "error" — a commission-model practitioner who hasn't
    // finished Stripe Connect onboarding yet, not a Stripe-side failure.
    // Own message so the client sees something honest rather than a
    // generic "couldn't book".
    await redirectWithError("practitionerNotReady");
    return;
  }

  // software_provider: no payment gate for this practitioner — book
  // immediately, exactly like every booking before this epic.
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
      delivery_type: service.delivery_type,
      phone_number: service.phone_number,
      meeting_link: service.meeting_link,
      service_name: service.name,
      price_cents: service.price_cents,
      currency: service.currency,
      delivery_info: service.delivery_info,
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

  // Create the video session for an online booking, post-commit. Like the
  // email send below, it's a side effect that must never fail the booking
  // that already committed — ensureVideoSession never throws (logs
  // internally). Self-guards on delivery_type, but gated here too to skip
  // a pointless round-trip for phone/in-person bookings.
  if (service.delivery_type === "online") {
    await ensureVideoSession(booking.id);
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
