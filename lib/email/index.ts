import { createTranslator } from "next-intl";
import { createClient } from "@/lib/supabase/server";
import type { EmailProvider } from "./types";
import { ResendEmailProvider } from "./providers/resend";
import { BookingConfirmationEmail } from "./templates/BookingConfirmationEmail";
import { CancellationNoticeEmail } from "./templates/CancellationNoticeEmail";
import enMessages from "@/messages/en.json";
import bgMessages from "@/messages/bg.json";

// Module-scoped singleton, mirroring lib/rate-limit.ts's Redis client —
// never exported. To swap providers later: write a new class
// implementing EmailProvider and change this one line; nothing else in
// the app imports Resend or knows it exists.
const provider: EmailProvider = new ResendEmailProvider();

export type Locale = "en" | "bg";
const MESSAGES: Record<Locale, typeof enMessages> = { en: enMessages, bg: bgMessages };
const INTL_LOCALES: Record<Locale, string> = { en: "en-US", bg: "bg-BG" };

// Exported so callers (e.g. bookSlot, which only has next-intl's
// broader `string` from getLocale()) can narrow to exactly this
// module's supported locales before calling sendBookingConfirmationEmails.
export function normalizeLocale(value: string | null): Locale {
  return value === "en" ? "en" : "bg";
}

function translator(locale: Locale) {
  return createTranslator({ locale, messages: MESSAGES[locale], namespace: "Email" });
}

// A duration relative to an instant, formatted for display — same
// underlying instant (start_utc) shown two ways for client-facing
// emails, since the client's saved timezone is a best-known value
// (captured at booking time) rather than an authoritative account
// setting, unlike a practitioner's. includeUtcBracket is false for
// practitioner emails, where their saved timezone is unambiguous and a
// second reference would just be noise.
function formatSessionTime(
  startUtc: string,
  timezone: string | null,
  locale: Locale,
  includeUtcBracket: boolean,
): string {
  const intlLocale = INTL_LOCALES[locale];
  const date = new Date(startUtc);
  const utcFormatted =
    new Intl.DateTimeFormat(intlLocale, { dateStyle: "full", timeStyle: "short", timeZone: "UTC" }).format(date) +
    " UTC";

  if (!timezone) return utcFormatted;

  const localFormatted = new Intl.DateTimeFormat(intlLocale, {
    dateStyle: "full",
    timeStyle: "short",
    timeZone: timezone,
  }).format(date);

  return includeUtcBracket ? `${localFormatted} (${timezone}) — ${utcFormatted}` : `${localFormatted} (${timezone})`;
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
  start_utc: string;
  end_utc: string;
  status: string;
};

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
