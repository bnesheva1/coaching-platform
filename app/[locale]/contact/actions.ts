"use server";

import { headers } from "next/headers";
import { getTranslations } from "next-intl/server";
import { checkRateLimit, getClientIp, contactLimiter } from "@/lib/rate-limit";
import { sendContactMessage } from "@/lib/email";

const MAX_NAME_LENGTH = 100;
const MAX_EMAIL_LENGTH = 254;
const MIN_MESSAGE_LENGTH = 10;
const MAX_MESSAGE_LENGTH = 2000;
// Loose on purpose (catches the obviously-malformed case, not a full
// RFC 5322 validator) — Resend/the receiving inbox is the real
// authority on deliverability; this is just a friendly, fast check.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const CATEGORY_VALUES = ["booking", "practitioner", "other"] as const;
type Category = (typeof CATEGORY_VALUES)[number];

export type ContactFormState = {
  errors?: {
    name?: string;
    email?: string;
    category?: string;
    message?: string;
  };
  generalError?: string;
  success?: boolean;
} | null;

// Duplicated from app/[locale]/signup/actions.ts rather than shared —
// same reasoning as this codebase's other "use server" modules (see
// EditableIdentity.tsx's comment on AvailabilitySection.tsx): every
// export from a "use server" file becomes a callable server action, so
// a plain internal helper isn't something to share across two
// unrelated routes' action files just to avoid one small duplication.
async function verifyTurnstileToken(token: string | null): Promise<boolean> {
  if (!process.env.TURNSTILE_SECRET_KEY) return true;
  if (!token) return false;

  const response = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      secret: process.env.TURNSTILE_SECRET_KEY,
      response: token,
    }),
  });
  const result = await response.json();
  return result.success === true;
}

export async function submitContact(
  _prevState: ContactFormState,
  formData: FormData,
): Promise<ContactFormState> {
  const t = await getTranslations("Contact");

  // Honeypot — a field real visitors never see (hidden off-screen in
  // ContactForm.tsx's CSS, not type="hidden", which some bots skip) but
  // that bots filling every field in a scraped form reliably populate.
  // Pretending success (rather than returning an error) doesn't tip a
  // bot off that it was caught, so it has no signal to adapt on.
  const honeypot = (formData.get("website") as string | null) ?? "";
  if (honeypot.trim() !== "") {
    return { success: true };
  }

  const ip = getClientIp(await headers());
  const { success: withinLimit } = await checkRateLimit(contactLimiter, ip);
  if (!withinLimit) {
    return { generalError: t("errorTooManyAttempts") };
  }

  const name = ((formData.get("name") as string) ?? "").trim();
  const email = ((formData.get("email") as string) ?? "").trim();
  const category = (formData.get("category") as string) ?? "";
  const message = ((formData.get("message") as string) ?? "").trim();

  const errors: NonNullable<ContactFormState>["errors"] = {};

  if (!name) {
    errors.name = t("errorRequired");
  } else if (name.length > MAX_NAME_LENGTH) {
    errors.name = t("errorTooLong", { max: MAX_NAME_LENGTH });
  }

  if (!email) {
    errors.email = t("errorRequired");
  } else if (email.length > MAX_EMAIL_LENGTH) {
    errors.email = t("errorTooLong", { max: MAX_EMAIL_LENGTH });
  } else if (!EMAIL_RE.test(email)) {
    errors.email = t("errorEmailInvalid");
  }

  if (!CATEGORY_VALUES.includes(category as Category)) {
    errors.category = t("errorRequired");
  }

  if (!message) {
    errors.message = t("errorRequired");
  } else if (message.length < MIN_MESSAGE_LENGTH) {
    errors.message = t("errorMessageTooShort", { min: MIN_MESSAGE_LENGTH });
  } else if (message.length > MAX_MESSAGE_LENGTH) {
    errors.message = t("errorTooLong", { max: MAX_MESSAGE_LENGTH });
  }

  if (Object.keys(errors).length > 0) {
    return { errors };
  }

  // Checked last, after every cheap validation has already passed —
  // no reason to make someone solve a captcha only to be told they
  // forgot a field.
  const captchaToken = formData.get("cf-turnstile-response") as string | null;
  const captchaValid = await verifyTurnstileToken(captchaToken);
  if (!captchaValid) {
    return { generalError: t("errorCaptchaFailed") };
  }

  const categoryLabelKeys: Record<Category, "categoryBooking" | "categoryPractitioner" | "categoryOther"> = {
    booking: "categoryBooking",
    practitioner: "categoryPractitioner",
    other: "categoryOther",
  };
  const categoryLabel = t(categoryLabelKeys[category as Category]);

  const result = await sendContactMessage({ categoryLabel, name, email, message });
  if (!result.success) {
    return { generalError: t("errorSendFailed") };
  }

  return { success: true };
}
