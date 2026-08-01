"use server";

import { getTranslations, getLocale } from "next-intl/server";
import { redirect } from "@/i18n/navigation";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/serviceRole";

export type AuthFormState = { error: string } | null;

export async function resetPassword(
  _prevState: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const t = await getTranslations("Auth");
  const locale = await getLocale();

  const password = (formData.get("password") as string) ?? "";
  const confirmPassword = (formData.get("confirmPassword") as string) ?? "";

  if (password.length < 12) {
    return { error: t("passwordTooShort") };
  }
  if (password !== confirmPassword) {
    return { error: t("passwordMismatch") };
  }

  // The cookie-based client here IS the recovery session established by
  // /auth/callback after the emailed link was verified — page.tsx
  // already checked a session exists before rendering this form, but
  // the action re-checks independently rather than trusting that; a
  // direct call here with no session at all shouldn't silently proceed.
  const supabase = await createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) {
    return { error: t("resetLinkExpiredTitle") };
  }

  const { error: updateError } = await supabase.auth.updateUser({ password });
  if (updateError) {
    return { error: updateError.message };
  }

  // Kicks out every session for this user, not just this one — the
  // whole point of a password reset is that a stolen-password attacker
  // (if that's why this reset happened) loses access too, not just
  // "starting now." 'global' scope, confirmed via the SDK's own source,
  // revokes ALL of a user's sessions given any one of their still-valid
  // access tokens, not just the token's own session.
  const adminClient = createServiceRoleClient();
  const { error: signOutError } = await adminClient.auth.admin.signOut(session.access_token, "global");
  if (signOutError) {
    console.error("resetPassword: global signOut failed", { error: signOutError.message });
  }

  // Belt-and-suspenders: the admin signOut above already invalidated
  // this session server-side, but this also clears the local cookie so
  // the browser doesn't keep sending a token that's now dead.
  await supabase.auth.signOut();

  redirect({ href: "/login?passwordReset=1", locale });
  return null;
}
