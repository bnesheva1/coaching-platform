"use server";

import { headers } from "next/headers";
import { getTranslations, getLocale } from "next-intl/server";
import { redirect } from "@/i18n/navigation";
import { createClient } from "@/lib/supabase/server";
import { checkRateLimit, getClientIp, signupLimiter } from "@/lib/rate-limit";

export type AuthFormState = { error: string } | null;

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

  const ip = getClientIp(await headers());
  const { success } = await checkRateLimit(signupLimiter, ip);
  if (!success) {
    return { error: t("tooManyAttempts") };
  }

  const email = formData.get("email") as string;
  const password = formData.get("password") as string;
  const displayName = formData.get("displayName") as string;
  const role = formData.get("role") as string;
  const captchaToken = formData.get("cf-turnstile-response") as string | null;

  if (password.length < 12) {
    return { error: t("passwordTooShort") };
  }

  const captchaValid = await verifyTurnstileToken(captchaToken);
  if (!captchaValid) {
    return { error: t("captchaFailed") };
  }

  const supabase = await createClient();

  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: { display_name: displayName, role },
    },
  });

  if (error) {
    // Supabase's own auth error messages (e.g. "User already
    // registered") aren't ours to translate — see the same note in
    // login/actions.ts.
    return { error: error.message };
  }

  const locale = await getLocale();

  // If email confirmation is disabled on the Supabase project, signUp
  // returns an active session immediately — otherwise the user has to
  // click the confirmation link first.
  if (data.session) {
    redirect({
      href: role === "practitioner" ? "/practitioner-dashboard" : "/client-dashboard",
      locale,
    });
    return null;
  }

  redirect({ href: "/signup/check-email", locale });
  return null;
}
