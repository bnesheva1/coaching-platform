import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/serviceRole";
import { BookingConfirmationEmail } from "./templates/BookingConfirmationEmail";
import { CancellationNoticeEmail } from "./templates/CancellationNoticeEmail";
import { ContactMessageEmail } from "./templates/ContactMessageEmail";
import { PasswordResetEmail } from "./templates/PasswordResetEmail";
import { EmailConfirmationEmail } from "./templates/EmailConfirmationEmail";
import { BulkCancellationSummaryEmail } from "./templates/BulkCancellationSummaryEmail";
import { provider, translator, footerText, normalizeLocale, formatSessionTime, formatMoney, type Locale } from "./shared";
import { raiseAlert } from "@/lib/alerts";
import type { SendEmailResult } from "./types";

export type { Locale } from "./shared";
export { normalizeLocale } from "./shared";

// Health-check pass-through: the admin health page asks the seam, never the
// Resend SDK, whether email credentials are live.
export function checkEmailConnection() {
  return provider.checkConnection();
}

type BookingEmailContext = {
  // Nullable in practice, not just in principle — a pre-existing
  // account from before profiles.email existed (and hasn't been
  // backfilled) genuinely has this null. See the guards below.
  client_email: string | null;
  client_display_name: string | null;
  client_locale: string;
  client_timezone: string | null;
  practitioner_email: string | null;
  practitioner_display_name: string | null;
  practitioner_locale: string;
  practitioner_timezone: string;
  service_name: string;
  // Read from the booking's own frozen snapshot (bookings.delivery_type/
  // delivery_info/phone_number/meeting_link), not live from services —
  // see get_booking_email_context's own comment for why that distinction
  // matters. Field names kept as service_* to avoid touching every call
  // site's property access, even though the values are booking-owned.
  service_delivery_type: string | null;
  service_delivery_info: string | null;
  service_phone_number: string | null;
  service_meeting_link: string | null;
  start_utc: string;
  end_utc: string;
  status: string;
};

// The type-aware "how to join" label — shared by the confirmation
// email below and lib/email/reminders.ts, since both show the exact
// same delivery-info block. Not exported beyond this module's own
// callers deliberately; reminders.ts has its own copy since it doesn't
// import from index.ts (see the comment there for why).
function deliveryLabel(t: ReturnType<typeof translator>, deliveryType: string | null): string {
  return deliveryType === "online"
    ? t("deliveryLabelOnline")
    : deliveryType === "phone"
      ? t("deliveryLabelPhone")
      : t("deliveryLabelInPerson");
}

// The value shown alongside deliveryLabel above — phone_number for a
// phone booking, delivery_info (an address, or an online meeting link
// from before that stopped being collected — see services-actions.ts's
// own comment on preserving a legacy value on unrelated edits) for
// everything else. Mirrors BookingsList.tsx's own deliveryDetailsValue
// selection exactly, so the dashboard and the confirmation email never
// disagree about what a booking's delivery details actually are.
function deliveryValue(context: BookingEmailContext): string | undefined {
  return (
    (context.service_delivery_type === "phone" ? context.service_phone_number : context.service_delivery_info) ??
    undefined
  );
}

// The single data-fetch point for all of this slice's email
// composition — get_booking_email_context is SECURITY DEFINER, scoped
// so the caller must already be one of the two parties on this specific
// booking (see the migration). Returns null (and logs) on any failure —
// callers never throw past this point, per this module's "email is a
// side effect, never a reason to fail the caller's own action" contract.
async function fetchBookingEmailContext(bookingId: string): Promise<BookingEmailContext | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .rpc("get_booking_email_context", { target_booking_id: bookingId })
    .single();

  if (error || !data) {
    console.error("lib/email: get_booking_email_context failed", { bookingId, error });
    return null;
  }
  return data as BookingEmailContext;
}

// Service-role context fetch for PLATFORM-initiated sends (admin bulk cancel):
// the auth-scoped get_booking_email_context RPC deliberately only returns to a
// party of the booking, so an admin — who is neither client nor practitioner —
// would get nothing from it. This reads the same fields directly under the
// service role (which bypasses the column grants), so admin-initiated
// cancellation notices actually reach the client.
async function fetchBookingEmailContextAdmin(bookingId: string): Promise<BookingEmailContext | null> {
  const supabase = createServiceRoleClient();
  const { data: b } = await supabase
    .from("bookings")
    .select("client_id, practitioner_id, service_name, start_utc, end_utc, status, delivery_type, delivery_info, phone_number, meeting_link")
    .eq("id", bookingId)
    .single();
  if (!b) return null;
  const [{ data: profs }, { data: ppr }] = await Promise.all([
    supabase.from("profiles").select("id, email, display_name, locale, timezone").in("id", [b.client_id as string, b.practitioner_id as string]),
    supabase.from("practitioner_profiles").select("timezone").eq("id", b.practitioner_id as string).single(),
  ]);
  const client = (profs ?? []).find((p) => p.id === b.client_id);
  const prac = (profs ?? []).find((p) => p.id === b.practitioner_id);
  return {
    client_email: (client?.email as string | null) ?? null,
    client_display_name: (client?.display_name as string | null) ?? null,
    client_locale: (client?.locale as string) ?? "bg",
    client_timezone: (client?.timezone as string | null) ?? null,
    practitioner_email: (prac?.email as string | null) ?? null,
    practitioner_display_name: (prac?.display_name as string | null) ?? null,
    practitioner_locale: (prac?.locale as string) ?? "bg",
    practitioner_timezone: (ppr?.timezone as string) ?? "UTC",
    service_name: (b.service_name as string) ?? "—",
    service_delivery_type: b.delivery_type as string,
    service_delivery_info: (b.delivery_info as string | null) ?? null,
    service_phone_number: (b.phone_number as string | null) ?? null,
    service_meeting_link: (b.meeting_link as string | null) ?? null,
    start_utc: b.start_utc as string,
    end_utc: b.end_utc as string,
    status: b.status as string,
  };
}

// Sends both copies of a booking confirmation — one to the client (who
// just booked, live in the current request, hence clientLocale being
// passed in rather than read from context), one to the practitioner
// (not part of this request at all, so their stored locale/timezone is
// the only information available). Never throws; every failure is
// logged and swallowed so a bad send can't affect the booking that
// already succeeded.
//
// This is the software_provider path only (bookSlot's immediate-insert
// case, still running inside the client's own live session) — the
// commission path's confirmation is sendPaidBookingConfirmationEmails
// below, a deliberate separate copy: it runs from the Stripe webhook,
// which has no live session and no auth.uid() at all (same reasoning
// lib/email/reminders.ts already established for the cron path, not
// invented fresh here).
export async function sendBookingConfirmationEmails(bookingId: string, clientLocale: Locale): Promise<void> {
  const context = await fetchBookingEmailContext(bookingId);
  if (!context) return;

  if (!context.client_email) {
    // Shouldn't happen post-backfill (handle_new_user always sets
    // email at signup), but a null recipient reaching the provider
    // produces an opaque "`to` field must be a string" error instead
    // of a diagnosable one — worth catching here explicitly.
    console.error("sendBookingConfirmationEmails: client_email is null, skipping", { bookingId });
  } else {
    const tClient = translator(clientLocale);
    const clientTime = formatSessionTime(context.start_utc, context.client_timezone, clientLocale, true);
    const clientResult = await provider.send({
      to: context.client_email,
      subject: tClient("bookingConfirmationClientSubject", {
        counterpartyName: context.practitioner_display_name ?? "",
      }),
      react: BookingConfirmationEmail({
        heading: tClient("bookingConfirmationClientHeading"),
        body: tClient("bookingConfirmationClientBody", {
          recipientName: context.client_display_name ?? "",
          counterpartyName: context.practitioner_display_name ?? "",
          serviceName: context.service_name,
          sessionTime: clientTime,
        }),
        footer: footerText(clientLocale),
        deliveryLabel: deliveryLabel(tClient, context.service_delivery_type),
        deliveryInfo: deliveryValue(context),
      }),
    });
    if (!clientResult.success) {
      console.error("sendBookingConfirmationEmails: client email failed", {
        bookingId,
        recipient: context.client_email,
        error: clientResult.error,
      });
      await raiseAlert({
        type: "failed_email",
        subject: `${bookingId}:client`,
        message: "Booking confirmed but the client's confirmation email wasn't delivered.",
        context: { bookingId, recipient: context.client_email, error: clientResult.error },
        immediate: true,
      });
    }
  }

  if (!context.practitioner_email) {
    console.error("sendBookingConfirmationEmails: practitioner_email is null, skipping", { bookingId });
    return;
  }

  const practitionerLocale = normalizeLocale(context.practitioner_locale);
  const tPractitioner = translator(practitionerLocale);
  const practitionerTime = formatSessionTime(
    context.start_utc,
    context.practitioner_timezone,
    practitionerLocale,
    false,
  );
  const practitionerResult = await provider.send({
    to: context.practitioner_email,
    subject: tPractitioner("bookingConfirmationPractitionerSubject", {
      counterpartyName: context.client_display_name ?? "",
    }),
    react: BookingConfirmationEmail({
      heading: tPractitioner("bookingConfirmationPractitionerHeading"),
      body: tPractitioner("bookingConfirmationPractitionerBody", {
        recipientName: context.practitioner_display_name ?? "",
        counterpartyName: context.client_display_name ?? "",
        serviceName: context.service_name,
        sessionTime: practitionerTime,
      }),
      footer: footerText(practitionerLocale),
      deliveryLabel: deliveryLabel(tPractitioner, context.service_delivery_type),
      deliveryInfo: deliveryValue(context),
    }),
  });
  if (!practitionerResult.success) {
    console.error("sendBookingConfirmationEmails: practitioner email failed", {
      bookingId,
      recipient: context.practitioner_email,
      error: practitionerResult.error,
    });
    await raiseAlert({
      type: "failed_email",
      subject: `${bookingId}:practitioner`,
      message: "Booking confirmed but the practitioner's confirmation email wasn't delivered.",
      context: { bookingId, recipient: context.practitioner_email, error: practitionerResult.error },
      immediate: true,
    });
  }
}

// Sends exactly one email — to whichever party did NOT cancel. Their
// locale is always the stored one (they're never part of the request
// that triggered this), unlike the confirmation case above where the
// client is live.
export async function sendCancellationNoticeEmail(
  bookingId: string,
  // "platform" = an admin cancelled on the practitioner's behalf (bulk
  // cancel-and-refund) — notifies the CLIENT, like "practitioner" does, but with
  // distinct "the platform cancelled" wording. Returns whether the send
  // succeeded, so the bulk-cancel loop can set its per-booking idempotency
  // marker only on success (never notifying a client twice, nor marking a
  // failed send as done).
  cancelledBy: "client" | "practitioner" | "platform",
  // Optional free-text reason typed into the cancel confirm dialog — the
  // practitioner-cancel flow and the bulk platform-cancel both pass one. A line
  // on this existing email, not a new messaging system.
  note?: string,
): Promise<boolean> {
  // Platform (admin) sends can't use the auth-scoped context RPC — the admin
  // isn't a party to the booking — so they read it under the service role.
  const context =
    cancelledBy === "platform" ? await fetchBookingEmailContextAdmin(bookingId) : await fetchBookingEmailContext(bookingId);
  if (!context) return false;

  const recipient =
    cancelledBy === "client"
      ? {
          email: context.practitioner_email,
          name: context.practitioner_display_name,
          locale: normalizeLocale(context.practitioner_locale),
          timezone: context.practitioner_timezone as string | null,
          includeUtcBracket: false,
          counterpartyName: context.client_display_name,
        }
      : {
          email: context.client_email,
          name: context.client_display_name,
          locale: normalizeLocale(context.client_locale),
          timezone: context.client_timezone,
          includeUtcBracket: true,
          counterpartyName: context.practitioner_display_name,
        };

  if (!recipient.email) {
    console.error("sendCancellationNoticeEmail: recipient email is null, skipping", { bookingId, cancelledBy });
    return false;
  }

  const t = translator(recipient.locale);
  const sessionTime = formatSessionTime(
    context.start_utc,
    recipient.timezone,
    recipient.locale,
    recipient.includeUtcBracket,
  );
  const bodyKey =
    cancelledBy === "client"
      ? "cancellationNoticeBodyByClient"
      : cancelledBy === "platform"
        ? "cancellationNoticeBodyByPlatform"
        : "cancellationNoticeBodyByPractitioner";

  const result = await provider.send({
    to: recipient.email,
    subject: t("cancellationNoticeSubject", { serviceName: context.service_name }),
    react: CancellationNoticeEmail({
      heading: t("cancellationNoticeHeading"),
      body: t(bodyKey, {
        recipientName: recipient.name ?? "",
        counterpartyName: recipient.counterpartyName ?? "",
        serviceName: context.service_name,
        sessionTime,
      }),
      footer: footerText(recipient.locale),
      noteLabel: note ? t("cancellationNoticeNoteLabel") : undefined,
      note,
    }),
  });
  if (!result.success) {
    console.error("sendCancellationNoticeEmail: email failed", {
      bookingId,
      cancelledBy,
      recipient: recipient.email,
      error: result.error,
    });
  }
  return result.success;
}

// Tells a practitioner an immediate-booking client didn't complete payment in
// the window — they were waiting, and they're free again. Reuses the
// cancellation template (heading + body); no new email surface.
export async function sendImmediatePaymentFailedEmail(requestId: string): Promise<boolean> {
  const supabase = createServiceRoleClient();
  const { data: req } = await supabase.from("immediate_requests").select("practitioner_id, service_id").eq("id", requestId).single();
  if (!req) return false;
  const { data: prof } = await supabase.from("profiles").select("email, locale, display_name").eq("id", req.practitioner_id as string).single();
  if (!prof?.email) return false;
  const { data: service } = await supabase.from("services").select("name").eq("id", req.service_id as string).single();
  const locale = normalizeLocale(prof.locale as string);
  const t = translator(locale);
  const result = await provider.send({
    to: prof.email as string,
    subject: t("immediatePaymentFailedSubject"),
    react: CancellationNoticeEmail({
      heading: t("immediatePaymentFailedHeading"),
      body: t("immediatePaymentFailedBody", { service: (service?.name as string) ?? "—" }),
      footer: footerText(locale),
    }),
  });
  return result.success;
}

// Sent to a practitioner on the FIRST failed subscription-fee payment — before
// any restriction, since a failed card is usually just expired and Stripe will
// retry for ~a week (grace). Reuses the generic CancellationNoticeEmail shell,
// same as sendImmediatePaymentFailedEmail. The practitioner's contact + locale
// come from their stored profile (service role — a webhook has no session).
export async function sendSubscriptionGraceEmail(practitionerId: string): Promise<boolean> {
  const supabase = createServiceRoleClient();
  const { data: prof } = await supabase
    .from("profiles")
    .select("email, locale")
    .eq("id", practitionerId)
    .single();
  if (!prof?.email) {
    console.error("sendSubscriptionGraceEmail: practitioner email is null", { practitionerId });
    return false;
  }
  const locale = normalizeLocale(prof.locale as string);
  const t = translator(locale);
  const result = await provider.send({
    to: prof.email as string,
    subject: t("subscriptionGraceSubject"),
    react: CancellationNoticeEmail({
      heading: t("subscriptionGraceHeading"),
      body: t("subscriptionGraceBody"),
      footer: footerText(locale),
    }),
  });
  if (!result.success) {
    console.error("sendSubscriptionGraceEmail: email failed", { practitionerId, error: result.error });
  }
  return result.success;
}

// One summary to the practitioner after a bulk cancel-and-refund: what was
// cancelled on their behalf, and why. Reads their own contact/locale directly
// from profiles (service role). Sent exactly once per operation by the executor.
export async function sendBulkCancellationSummaryEmail(
  practitionerId: string,
  batchId: string,
  reason: string,
): Promise<boolean> {
  const supabase = createServiceRoleClient();
  const { data: prof } = await supabase
    .from("profiles")
    .select("email, locale, display_name")
    .eq("id", practitionerId)
    .single();
  if (!prof?.email) {
    console.error("sendBulkCancellationSummaryEmail: practitioner email is null", { practitionerId });
    return false;
  }
  const { data: ppr } = await supabase.from("practitioner_profiles").select("timezone").eq("id", practitionerId).single();
  const { data: bookings } = await supabase
    .from("bookings")
    .select("start_utc, service_name, client_id")
    .eq("cancellation_batch_id", batchId)
    .order("start_utc", { ascending: true });
  const clientIds = [...new Set((bookings ?? []).map((b) => b.client_id as string))];
  const { data: clients } = await supabase.from("profiles").select("id, display_name").in("id", clientIds);
  const nameById = new Map((clients ?? []).map((c) => [c.id as string, (c.display_name as string) ?? "—"]));

  const locale = normalizeLocale(prof.locale as string);
  const t = translator(locale);
  const tz = (ppr?.timezone as string | null) ?? null;
  const items = (bookings ?? []).map((b) => ({
    client: nameById.get(b.client_id as string) ?? "—",
    service: (b.service_name as string) ?? "—",
    when: formatSessionTime(b.start_utc as string, tz, locale, false),
  }));

  const result = await provider.send({
    to: prof.email as string,
    subject: t("bulkCancellationSummarySubject"),
    react: BulkCancellationSummaryEmail({
      heading: t("bulkCancellationSummaryHeading"),
      intro: t("bulkCancellationSummaryIntro", { count: items.length }),
      reasonLabel: t("bulkCancellationSummaryReasonLabel"),
      reason,
      items,
      footer: footerText(locale),
    }),
  });
  if (!result.success) {
    console.error("sendBulkCancellationSummaryEmail: email failed", { practitionerId, batchId, error: result.error });
  }
  return result.success;
}

// The Stripe-webhook counterpart to sendBookingConfirmationEmails —
// same emails, same templates, but fetched via the service-role client
// and get_booking_payment_context (no auth.uid() check, since a webhook
// has no session to check it against) rather than the ambient-session
// get_booking_email_context. Both parties' locale/timezone come from
// their stored profile — neither is "live" in a webhook request the
// way a client booking their own session is.
export async function sendPaidBookingConfirmationEmails(
  bookingId: string,
  amountPaidCents: number,
  currency: string,
): Promise<void> {
  const supabase = createServiceRoleClient();
  const { data: context, error } = await supabase
    .rpc("get_booking_payment_context", { target_booking_id: bookingId })
    .single<BookingEmailContext>();

  if (error || !context) {
    console.error("sendPaidBookingConfirmationEmails: get_booking_payment_context failed", { bookingId, error });
    return;
  }

  if (!context.client_email) {
    console.error("sendPaidBookingConfirmationEmails: client_email is null, skipping", { bookingId });
  } else {
    const clientLocale = normalizeLocale(context.client_locale);
    const tClient = translator(clientLocale);
    const clientTime = formatSessionTime(context.start_utc, context.client_timezone, clientLocale, true);
    const clientResult = await provider.send({
      to: context.client_email,
      subject: tClient("bookingConfirmationClientSubject", {
        counterpartyName: context.practitioner_display_name ?? "",
      }),
      react: BookingConfirmationEmail({
        heading: tClient("bookingConfirmationClientHeading"),
        body: tClient("bookingConfirmationClientBody", {
          recipientName: context.client_display_name ?? "",
          counterpartyName: context.practitioner_display_name ?? "",
          serviceName: context.service_name,
          sessionTime: clientTime,
        }),
        footer: footerText(clientLocale),
        deliveryLabel: deliveryLabel(tClient, context.service_delivery_type),
        deliveryInfo: deliveryValue(context),
        amountPaidLine: tClient("amountPaidLine", { amount: formatMoney(amountPaidCents, currency, clientLocale) }),
      }),
    });
    if (!clientResult.success) {
      console.error("sendPaidBookingConfirmationEmails: client email failed", {
        bookingId,
        recipient: context.client_email,
        error: clientResult.error,
      });
    }
  }

  if (!context.practitioner_email) {
    console.error("sendPaidBookingConfirmationEmails: practitioner_email is null, skipping", { bookingId });
    return;
  }

  const practitionerLocale = normalizeLocale(context.practitioner_locale);
  const tPractitioner = translator(practitionerLocale);
  const practitionerTime = formatSessionTime(context.start_utc, context.practitioner_timezone, practitionerLocale, false);
  const practitionerResult = await provider.send({
    to: context.practitioner_email,
    subject: tPractitioner("bookingConfirmationPractitionerSubject", {
      counterpartyName: context.client_display_name ?? "",
    }),
    react: BookingConfirmationEmail({
      heading: tPractitioner("bookingConfirmationPractitionerHeading"),
      body: tPractitioner("bookingConfirmationPractitionerBody", {
        recipientName: context.practitioner_display_name ?? "",
        counterpartyName: context.client_display_name ?? "",
        serviceName: context.service_name,
        sessionTime: practitionerTime,
      }),
      footer: footerText(practitionerLocale),
      deliveryLabel: deliveryLabel(tPractitioner, context.service_delivery_type),
      deliveryInfo: deliveryValue(context),
      amountPaidLine: tPractitioner("amountPaidLine", {
        amount: formatMoney(amountPaidCents, currency, practitionerLocale),
      }),
    }),
  });
  if (!practitionerResult.success) {
    console.error("sendPaidBookingConfirmationEmails: practitioner email failed", {
      bookingId,
      recipient: context.practitioner_email,
      error: practitionerResult.error,
    });
  }
}

// The "we charged you but couldn't actually create the booking" notice
// — the one case in this whole module with no booking row to fetch
// context through at all (get_profile_contact just reads a single
// profile, no join). Reuses CancellationNoticeEmail's shape (heading/
// body/footer) rather than a new template — conceptually the same kind
// of "here's what happened to a session you expected" notice.
export async function sendPaymentRefundedNotice({
  clientId,
  practitionerId,
  amountCents,
  currency,
}: {
  clientId: string;
  practitionerId: string;
  amountCents: number;
  currency: string;
}): Promise<void> {
  type ProfileContact = { email: string | null; display_name: string | null; locale: string };

  const supabase = createServiceRoleClient();
  const [{ data: clientRaw, error: clientError }, { data: practitionerRaw, error: practitionerError }] =
    await Promise.all([
      supabase.rpc("get_profile_contact", { target_profile_id: clientId }).single(),
      supabase.rpc("get_profile_contact", { target_profile_id: practitionerId }).single(),
    ]);
  const client = clientRaw as ProfileContact | null;
  const practitioner = practitionerRaw as ProfileContact | null;

  if (clientError || !client) {
    console.error("sendPaymentRefundedNotice: get_profile_contact (client) failed", { clientId, error: clientError });
    return;
  }
  if (!client.email) {
    console.error("sendPaymentRefundedNotice: client email is null, skipping", { clientId });
    return;
  }
  if (practitionerError || !practitioner) {
    console.error("sendPaymentRefundedNotice: get_profile_contact (practitioner) failed", {
      practitionerId,
      error: practitionerError,
    });
  }

  const locale = normalizeLocale(client.locale);
  const t = translator(locale);
  const amount = formatMoney(amountCents, currency, locale);

  const result = await provider.send({
    to: client.email,
    subject: t("paymentRefundedSubject"),
    react: CancellationNoticeEmail({
      heading: t("paymentRefundedHeading"),
      body: t("paymentRefundedBody", {
        recipientName: client.display_name ?? "",
        counterpartyName: practitioner?.display_name ?? "",
        amount,
      }),
      footer: footerText(locale),
    }),
  });
  if (!result.success) {
    console.error("sendPaymentRefundedNotice: email failed", { clientId, recipient: client.email, error: result.error });
  }
}

// Notifies the PRACTITIONER that their client used the emergency-contact
// fallback during a session (the "having trouble connecting" flow). A
// side effect of the client's reveal, so it never throws — logged and
// swallowed like the other transactional sends. Uses the service-role
// get_booking_payment_context (no auth.uid(), same as the paid-booking
// send) because it runs from the reveal route's after() with no reliable
// session, and reuses CancellationNoticeEmail's shape — same "here's what
// happened to a session you expected" notice family as the refund one.
export async function sendEmergencyContactRevealedNotice(bookingId: string): Promise<void> {
  const supabase = createServiceRoleClient();
  const { data: context, error } = await supabase
    .rpc("get_booking_payment_context", { target_booking_id: bookingId })
    .single<BookingEmailContext>();

  if (error || !context) {
    console.error("sendEmergencyContactRevealedNotice: context fetch failed", { bookingId, error });
    return;
  }
  if (!context.practitioner_email) {
    console.error("sendEmergencyContactRevealedNotice: practitioner_email is null, skipping", { bookingId });
    return;
  }

  const locale = normalizeLocale(context.practitioner_locale);
  const t = translator(locale);
  const sessionTime = formatSessionTime(context.start_utc, context.practitioner_timezone, locale, false);

  const result = await provider.send({
    to: context.practitioner_email,
    subject: t("emergencyContactRevealedSubject", { serviceName: context.service_name }),
    react: CancellationNoticeEmail({
      heading: t("emergencyContactRevealedHeading"),
      body: t("emergencyContactRevealedBody", {
        recipientName: context.practitioner_display_name ?? "",
        counterpartyName: context.client_display_name ?? "",
        serviceName: context.service_name,
        sessionTime,
      }),
      footer: footerText(locale),
    }),
  });
  if (!result.success) {
    console.error("sendEmergencyContactRevealedNotice: email failed", { bookingId, error: result.error });
  }
}

// Unlike every other function in this file, the send IS the point of
// the caller's action (the /contact form), not a side effect of one
// that already succeeded — so this returns the real SendEmailResult
// instead of swallowing failure into a console.error + void, letting
// the Server Action tell the visitor their message didn't go through
// instead of showing a false "sent" confirmation.
//
// `to` is CONTACT_SUPPORT_EMAIL — fixed, read server-side, never derived
// from the form's own fields. The category/name/email/message args
// below are content, not the destination.
export async function sendContactMessage({
  categoryLabel,
  name,
  email,
  message,
}: {
  categoryLabel: string;
  name: string;
  email: string;
  message: string;
}): Promise<SendEmailResult> {
  const supportEmail = process.env.CONTACT_SUPPORT_EMAIL;
  if (!supportEmail) {
    console.error("sendContactMessage: CONTACT_SUPPORT_EMAIL is not configured");
    return { success: false, error: "CONTACT_SUPPORT_EMAIL is not configured" };
  }

  const result = await provider.send({
    to: supportEmail,
    subject: `${categoryLabel}: ${name}`,
    react: ContactMessageEmail({ categoryLabel, name, email, message }),
  });
  if (!result.success) {
    console.error("sendContactMessage: email failed", { error: result.error });
  }
  return result;
}

// Same "return the real result" reasoning as sendContactMessage — the
// caller (app/[locale]/forgot-password/actions.ts) only calls this on
// the branch where the account genuinely exists, and never surfaces
// success/failure of the SEND itself back to the visitor either way
// (that would reopen the exact enumeration hole the generic response is
// there to close) — but it still needs the real result for its own
// server-side logging.
//
// actionLink is Supabase's own admin.generateLink() output, relayed
// as-is — never logged here, never logged by the caller, and never
// anything this function constructs or inspects itself.
export async function sendPasswordResetEmail({
  to,
  actionLink,
  locale,
}: {
  to: string;
  actionLink: string;
  locale: Locale;
}): Promise<SendEmailResult> {
  const t = translator(locale);
  const result = await provider.send({
    to,
    subject: t("passwordResetSubject"),
    react: PasswordResetEmail({
      heading: t("passwordResetHeading"),
      body: t("passwordResetBody"),
      buttonLabel: t("passwordResetButton"),
      actionLink,
      ignoreNote: t("passwordResetIgnoreNote"),
      footer: footerText(locale),
    }),
  });
  if (!result.success) {
    // Deliberately no actionLink/token in this log line — see the
    // module comment above.
    console.error("sendPasswordResetEmail: email failed", { error: result.error });
  }
  return result;
}

// Twin of sendPasswordResetEmail above — same reasoning, same
// actionLink contract (Supabase's own admin.generateLink({ type:
// "signup" }) output, relayed as-is, never logged). Called by
// app/[locale]/signup/actions.ts instead of letting Supabase's built-in
// signUp() auto-send its own confirmation email, so delivery goes
// through this app's Resend integration like every other transactional
// email here.
export async function sendEmailConfirmationEmail({
  to,
  actionLink,
  locale,
}: {
  to: string;
  actionLink: string;
  locale: Locale;
}): Promise<SendEmailResult> {
  const t = translator(locale);
  const result = await provider.send({
    to,
    subject: t("emailConfirmationSubject"),
    react: EmailConfirmationEmail({
      heading: t("emailConfirmationHeading"),
      body: t("emailConfirmationBody"),
      buttonLabel: t("emailConfirmationButton"),
      actionLink,
      footer: footerText(locale),
    }),
  });
  if (!result.success) {
    console.error("sendEmailConfirmationEmail: email failed", { error: result.error });
  }
  return result;
}
