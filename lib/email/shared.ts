import { createTranslator } from "next-intl";
import type { EmailProvider } from "./types";
import { ResendEmailProvider } from "./providers/resend";
import enMessages from "@/messages/en.json";
import bgMessages from "@/messages/bg.json";

// Module-scoped singleton, mirroring lib/rate-limit.ts's Redis client —
// never exported directly. To swap providers later: write a new class
// implementing EmailProvider and change this one line; nothing else in
// the app imports Resend or knows it exists.
export const provider: EmailProvider = new ResendEmailProvider();

export type Locale = "en" | "bg";
const MESSAGES: Record<Locale, typeof enMessages> = { en: enMessages, bg: bgMessages };
const INTL_LOCALES: Record<Locale, string> = { en: "en-US", bg: "bg-BG" };

// Exported so callers (e.g. bookSlot, which only has next-intl's
// broader `string` from getLocale()) can narrow to exactly this
// module's supported locales before calling sendBookingConfirmationEmails.
export function normalizeLocale(value: string | null): Locale {
  return value === "en" ? "en" : "bg";
}

export function translator(locale: Locale) {
  return createTranslator({ locale, messages: MESSAGES[locale], namespace: "Email" });
}

// A duration relative to an instant, formatted for display — same
// underlying instant (start_utc) shown two ways for client-facing
// emails, since the client's saved timezone is a best-known value
// (captured at booking time) rather than an authoritative account
// setting, unlike a practitioner's. includeUtcBracket is false for
// practitioner emails, where their saved timezone is unambiguous and a
// second reference would just be noise.
export function formatSessionTime(
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
