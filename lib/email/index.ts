import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/serviceRole";
import { BookingConfirmationEmail } from "./templates/BookingConfirmationEmail";
import { CancellationNoticeEmail } from "./templates/CancellationNoticeEmail";
import { ContactMessageEmail } from "./templates/ContactMessageEmail";
import { PasswordResetEmail } from "./templates/PasswordResetEmail";
import { EmailConfirmationEmail } from "./templates/EmailConfirmationEmail";
import { provider, translator, footerText, normalizeLocale, formatSessionTime, formatMoney, type Locale } from "./shared";
import { raiseAlert } from "@/lib/alerts";
import type { SendEmailResult } from "./types";

export type { Locale } from "./shared";
export { normalizeLocale } from "./shared";

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
  cancelledBy: "client" | "practitioner",
  // Optional free-text reason typed into the cancel confirm dialog —
  // currently only the practitioner-cancel flow ever passes one (see
  // cancel-booking-actions.ts). A line on this existing email, not a
  // new messaging system: no thread, no reply-to-it, just shown once.
  note?: string,
): Promise<void> {
  const context = await fetchBookingEmailContext(bookingId);
  if (!context) return;

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
    return;
  }

  const t = translator(recipient.locale);
  const sessionTime = formatSessionTime(
    context.start_utc,
    recipient.timezone,
    recipient.locale,
    recipient.includeUtcBracket,
  );
  const bodyKey = cancelledBy === "client" ? "cancellationNoticeBodyByClient" : "cancellationNoticeBodyByPractitioner";

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
