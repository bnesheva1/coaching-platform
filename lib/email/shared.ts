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

// The email footer, with the brand name (Brand.siteName) interpolated in the
// recipient's locale — the sync-translator counterpart to lib/brand.ts's
// getSiteName, resolving the same dedicated brand key. Every send passes its
// footer through here so the brand lives in one place, not in each template.
export function footerText(locale: Locale): string {
  const brand = createTranslator({ locale, messages: MESSAGES[locale], namespace: "Brand" })("siteName");
  return translator(locale)("footer", { siteName: brand });
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

// cents -> a locale-formatted currency string (e.g. "60.00 €" / "€60.00"
// depending on locale convention) — Intl.NumberFormat handles the
// symbol placement/decimal convention per locale, not hardcoded here.
export function formatMoney(amountCents: number, currency: string, locale: Locale): string {
  return new Intl.NumberFormat(INTL_LOCALES[locale], { style: "currency", currency }).format(amountCents / 100);
}
