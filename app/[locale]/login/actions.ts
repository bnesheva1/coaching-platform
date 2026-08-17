"use server";

import { headers } from "next/headers";
import { getTranslations, getLocale } from "next-intl/server";
import { redirect } from "@/i18n/navigation";
import { createClient } from "@/lib/supabase/server";
import { checkRateLimit, getClientIp, loginLimiter } from "@/lib/rate-limit";

export type AuthFormState = { error: string } | null;

export async function login(
  _prevState: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const t = await getTranslations("Auth");

  const ip = getClientIp(await headers());
  const { success } = await checkRateLimit(loginLimiter, ip);
  if (!success) {
    return { error: t("tooManyAttempts") };
  }

  const email = formData.get("email") as string;
  const password = formData.get("password") as string;

  const supabase = await createClient();

  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (error) {
    // Supabase's own auth error messages (e.g. "Invalid login
    // credentials") aren't ours to translate — they come from the Auth
    // API directly, always in English, regardless of locale. Mapping
    // every possible Supabase error code to a translated equivalent
    // would be a separate, larger effort.
    return { error: error.message };
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", data.user.id)
    .single();

  const locale = await getLocale();

  // Return-to support (e.g. a guest who clicked "save" on a profile): honour a
  // `next` path ONLY when it's a same-site relative path — must start with a
  // single "/" (rejecting "//"/protocol-relative and backslash tricks) so it
  // can't become an open redirect. The locale prefix is added by redirect().
  const rawNext = formData.get("next");
  const next = typeof rawNext === "string" ? rawNext : "";
  const safeNext = next.startsWith("/") && !next.startsWith("//") && !next.includes("\\") ? next : null;
  if (safeNext) {
    redirect({ href: safeNext, locale });
    return null;
  }

  redirect({
    href:
      profile?.role === "admin"
        ? "/admin"
        : profile?.role === "practitioner"
          ? "/practitioner-dashboard"
          : "/client-dashboard",
    locale,
  });
  return null;
}
