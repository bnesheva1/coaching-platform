"use server";

import { headers } from "next/headers";
import { getTranslations, getLocale } from "next-intl/server";
import { redirect } from "@/i18n/navigation";
import { createServiceRoleClient } from "@/lib/supabase/serviceRole";
import { checkRateLimit, getClientIp, signupLimiter } from "@/lib/rate-limit";
import { siteOrigin } from "@/lib/siteOrigin";
import { sendEmailConfirmationEmail, normalizeLocale } from "@/lib/email";

// values echoes back displayName/email/role on a rejected submission —
// deliberately EXCLUDES password (never echo a submitted password back
// to the client, matching common practice elsewhere; a rejected signup
// just needs it retyped). See ProfileFormState (practitioner-dashboard/
// actions.ts) for the full reasoning behind this pattern.
export type AuthFormState = { error: string; values?: { displayName?: string; email?: string; role?: string } } | null;

// Verified here, in code, rather than via Supabase's own "Bot and Abuse
// Protection" dashboard toggle — that toggle turned out to be a single
// global on/off covering every auth flow, which would have required
// CAPTCHA on login too. Doing it ourselves keeps this signup-only, as
// intended. Not configured yet locally/in early environments returns
// true (fail open) rather than blocking every signup over a missing
// optional key.
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

export async function signup(
  _prevState: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const t = await getTranslations("Auth");

  const email = formData.get("email") as string;
  const password = formData.get("password") as string;
  const displayName = formData.get("displayName") as string;
  const role = formData.get("role") as string;
  const captchaToken = formData.get("cf-turnstile-response") as string | null;
  const values = { displayName, email, role };

  const ip = getClientIp(await headers());
  const { success } = await checkRateLimit(signupLimiter, ip);
  if (!success) {
    return { error: t("tooManyAttempts"), values };
  }

  if (password.length < 12) {
    return { error: t("passwordTooShort"), values };
  }

  const captchaValid = await verifyTurnstileToken(captchaToken);
  if (!captchaValid) {
    return { error: t("captchaFailed"), values };
  }

  const locale = await getLocale();

  // admin.generateLink (not the public signUp) — same reasoning as
  // requestPasswordReset in forgot-password/actions.ts: creates the
  // user and returns Supabase's own token/expiry/single-use link, but
  // never sends an email itself, so delivery goes through this app's
  // own Resend seam instead of Supabase's built-in SMTP. This also
  // means signUp's old "session comes back immediately if confirmation
  // is disabled" branch no longer applies — generateLink is an
  // admin-side operation and never establishes a session for the
  // calling browser either way, so every signup now goes through
  // check-email regardless of the project's confirmation setting.
  const supabase = createServiceRoleClient();
  const origin = await siteOrigin();

  // Captured once at signup as the recipient's stored preference for
  // emails they aren't live-in-a-request for (see lib/email) — signup
  // is itself a locale-prefixed route, so this is simply "whichever
  // language they signed up in," not a separate question asked of them.
  const { data, error } = await supabase.auth.admin.generateLink({
    type: "signup",
    email,
    password,
    options: {
      data: { display_name: displayName, role, locale },
      redirectTo: `${origin}/${locale}/signup/confirm`,
    },
  });

  if (error) {
    // Supabase's own auth error messages (e.g. "User already
    // registered") aren't ours to translate — see the same note in
    // login/actions.ts.
    return { error: error.message, values };
  }

  // Straight to /signup/confirm, NOT through /auth/callback — same
  // reasoning as requestPasswordReset: generateLink()'s links use the
  // implicit flow (tokens in the URL #fragment), which never reaches
  // the server at all, so /auth/callback's ?code= handling would never
  // find anything to exchange.
  // Only attempt to send if email delivery is actually configured —
  // otherwise the send is a guaranteed failure and we skip straight to
  // the fallback below.
  const emailDeliveryConfigured = Boolean(process.env.RESEND_API_KEY && process.env.RESEND_FROM_EMAIL);
  let confirmationSent = false;
  if (emailDeliveryConfigured) {
    const sendResult = await sendEmailConfirmationEmail({
      to: email,
      actionLink: data.properties.action_link,
      locale: normalizeLocale(locale),
    });
    confirmationSent = sendResult.success;
    if (!sendResult.success) {
      console.error("signup: sendEmailConfirmationEmail failed", { email, error: sendResult.error });
    }
  }

  // TEMPORARY (until Resend is configured): if no confirmation email could
  // be delivered, the account would otherwise be permanently unusable — no
  // link to click, and login rejects an unconfirmed email. So confirm it
  // immediately and send them to log in. This is entirely self-disabling:
  // the moment RESEND_API_KEY + RESEND_FROM_EMAIL are set and a send
  // succeeds, confirmationSent is true and the normal check-email flow
  // resumes with no code change. Remove this branch once email delivery is
  // solid if you want to hard-require confirmation again.
  if (!confirmationSent) {
    if (data.user) {
      await supabase.auth.admin.updateUserById(data.user.id, { email_confirm: true });
    }
    console.warn("signup: email delivery unavailable — auto-confirmed account so it isn't stranded", { email });
    redirect({ href: "/login", locale });
    return null;
  }

  redirect({ href: "/signup/check-email", locale });
  return null;
}
