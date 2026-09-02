"use server";

import { headers } from "next/headers";
import { getTranslations, getLocale } from "next-intl/server";
import { redirect, getPathname } from "@/i18n/navigation";
import { createServiceRoleClient } from "@/lib/supabase/serviceRole";
import {
  checkRateLimit,
  getClientIp,
  passwordResetLimiter,
  passwordResetEmailLimiter,
} from "@/lib/rate-limit";
import { sendPasswordResetEmail, normalizeLocale } from "@/lib/email";

export type AuthFormState = { error: string } | null;

// Every code path below — rate-limited, malformed email, no such
// account, a real send — ends the same way: redirect to the same
// check-email page, after waiting out this same floor. A fast reject
// for "no such user" alongside a slow real generateLink+Resend round
// trip would let an attacker infer account existence purely from
// response latency, even with an identical response body.
const MIN_RESPONSE_MS = 800;

// Duplicated from app/[locale]/p/[username]/booking-actions.ts rather
// than shared — same reasoning as this codebase's other "use server"
// helpers (every export from a "use server" file becomes a callable
// server action, so small internal helpers aren't shared across
// unrelated routes' action files just to avoid one duplication).
async function siteOrigin(): Promise<string> {
  const headersList = await headers();
  const host = headersList.get("host") ?? "localhost:3000";
  const protocol = host.startsWith("localhost") ? "http" : "https";
  return `${protocol}://${host}`;
}

export async function requestPasswordReset(
  _prevState: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const start = Date.now();
  const t = await getTranslations("Auth");
  const locale = await getLocale();

  const ip = getClientIp(await headers());
  const email = ((formData.get("email") as string) ?? "").trim().toLowerCase();

  // Two independent limiters, both must pass — IP catches one attacker
  // probing many emails; the email-keyed one catches one victim's
  // inbox getting flooded from many different IPs. A rate-limit
  // rejection is the one case that DOES get its own error (rather than
  // being folded into the generic redirect below) — it's about the
  // requester's own behavior, not about whether the target account
  // exists, so it doesn't leak anything.
  const { success: ipOk } = await checkRateLimit(passwordResetLimiter, ip);
  const emailOk = email ? (await checkRateLimit(passwordResetEmailLimiter, email)).success : true;
  if (!ipOk || !emailOk) {
    return { error: t("tooManyAttempts") };
  }

  if (email) {
    const supabase = createServiceRoleClient();
    const origin = await siteOrigin();

    // admin.generateLink (not the public resetPasswordForEmail) —
    // Supabase's own native token generation/expiry/single-use
    // enforcement, but returns the link instead of emailing it itself,
    // so delivery can go through this app's own Resend seam instead of
    // Supabase's built-in SMTP.
    // Straight to /reset-password, NOT through /auth/callback — that
    // route only handles the PKCE ?code= flow (exchangeCodeForSession),
    // but admin.generateLink()'s recovery links use the implicit flow
    // instead (tokens in the URL #fragment, confirmed live), which
    // never reaches the server at all. /reset-password's own client
    // component reads the fragment directly; routing through
    // /auth/callback first would just be a pointless extra hop with no
    // ?code= for it to find.
    const { data, error } = await supabase.auth.admin.generateLink({
      type: "recovery",
      email,
      options: { redirectTo: `${origin}${getPathname({ href: "/reset-password", locale })}` },
    });

    // Deliberately not branching on WHY this failed (no such user vs.
    // anything else) — both are just "don't send," logged the same
    // way, never surfaced to the caller. The action_link itself is
    // never logged, here or in sendPasswordResetEmail.
    if (!error) {
      await sendPasswordResetEmail({
        to: email,
        actionLink: data.properties.action_link,
        locale: normalizeLocale(locale),
      });
    } else {
      console.error("requestPasswordReset: generateLink failed", { error: error.message });
    }
  }

  const elapsed = Date.now() - start;
  if (elapsed < MIN_RESPONSE_MS) {
    await new Promise((resolve) => setTimeout(resolve, MIN_RESPONSE_MS - elapsed));
  }

  redirect({ href: "/forgot-password/check-email", locale });
  return null;
}
