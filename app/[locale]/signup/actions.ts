"use server";

import { headers } from "next/headers";
import { getTranslations, getLocale } from "next-intl/server";
import { redirect } from "@/i18n/navigation";
import { createServiceRoleClient } from "@/lib/supabase/serviceRole";
import { checkRateLimit, getClientIp, signupLimiter } from "@/lib/rate-limit";
import { siteOrigin } from "@/lib/siteOrigin";
import { sendEmailConfirmationEmail, normalizeLocale } from "@/lib/email";
import { defaultBillingModel } from "@/lib/payments";
import { isEnabled } from "@/lib/flags";

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

  // Admin kill switch: registration closed for this role. Per-role so
  // practitioner onboarding can be paused while still taking clients (or vice
  // versa). role is validated against the two known values — anything else is
  // treated as a client signup by the hardened handle_new_user trigger anyway,
  // so it's gated by the client switch here too. Checked before any account is
  // created; an existing account is unaffected.
  const registrationFlag = role === "practitioner" ? "practitionerRegistration" : "clientRegistration";
  if (!(await isEnabled(registrationFlag))) {
    return { error: t("registrationClosed"), values };
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

  // A new practitioner inherits this deployment's default billing model,
  // set explicitly here at creation. The DB trigger already created the
  // practitioner_profiles row with the column default; this overrides it
  // per deployment (DEFAULT_BILLING_MODEL env) without a migration. The
  // per-practitioner field can still be changed afterwards.
  if (role === "practitioner" && data.user) {
    await supabase
      .from("practitioner_profiles")
      .update({ billing_model: defaultBillingModel() })
      .eq("id", data.user.id);
  }

  // Whether email confirmation is enforced — the requireEmailConfirmation
  // flag (deploy scope, default off; see lib/flags/registry.ts for why it's
  // not admin-toggleable). Off for testing, on at launch.
  const requireConfirmation = await isEnabled("requireEmailConfirmation");

  if (!requireConfirmation) {
    // Confirmation not required: auto-confirm so the account is immediately
    // usable and send them to log in. No confirmation email, no
    // check-email step — regardless of whether a send would have succeeded.
    if (data.user) {
      await supabase.auth.admin.updateUserById(data.user.id, { email_confirm: true });
    }
    redirect({ href: "/login", locale });
    return null;
  }

  // Confirmation required: send the confirmation email through our own
  // Resend seam (generateLink created the user unconfirmed above), then land
  // on check-email. The link uses the implicit flow (tokens in the URL
  // #fragment), so it goes to /signup/confirm directly, never /auth/callback.
  //
  // A send FAILURE is surfaced as an error, never auto-confirmed. Silently
  // confirming an account because the email didn't send is an auth bypass —
  // benign only while delivery always failed; once Resend fails
  // intermittently it would let through an account that should be held.
  const sendResult = await sendEmailConfirmationEmail({
    to: email,
    actionLink: data.properties.action_link,
    locale: normalizeLocale(locale),
  });
  if (!sendResult.success) {
    console.error("signup: sendEmailConfirmationEmail failed", { email, error: sendResult.error });
    return { error: t("confirmationEmailFailed"), values };
  }

  redirect({ href: "/signup/check-email", locale });
  return null;
}
