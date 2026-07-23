import { createClient } from "@/lib/supabase/server";
import { BookingConfirmationEmail } from "./templates/BookingConfirmationEmail";
import { CancellationNoticeEmail } from "./templates/CancellationNoticeEmail";
import { provider, translator, normalizeLocale, formatSessionTime, type Locale } from "./shared";

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
  service_delivery_type: string | null;
  service_delivery_info: string | null;
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
  return deliveryType === "online" ? t("deliveryLabelOnline") : t("deliveryLabelInPerson");
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
        footer: tClient("footer"),
        deliveryLabel: deliveryLabel(tClient, context.service_delivery_type),
        deliveryInfo: context.service_delivery_info ?? undefined,
      }),
    });
    if (!clientResult.success) {
      console.error("sendBookingConfirmationEmails: client email failed", {
        bookingId,
        recipient: context.client_email,
        error: clientResult.error,
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
      footer: tPractitioner("footer"),
      deliveryLabel: deliveryLabel(tPractitioner, context.service_delivery_type),
      deliveryInfo: context.service_delivery_info ?? undefined,
    }),
  });
  if (!practitionerResult.success) {
    console.error("sendBookingConfirmationEmails: practitioner email failed", {
      bookingId,
      recipient: context.practitioner_email,
      error: practitionerResult.error,
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
      footer: t("footer"),
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
