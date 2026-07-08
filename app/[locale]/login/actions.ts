"use server";

import { getLocale } from "next-intl/server";
import { redirect } from "@/i18n/navigation";
import { createClient } from "@/lib/supabase/server";

export type AuthFormState = { error: string } | null;

export async function login(
  _prevState: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
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
  redirect({
    href: profile?.role === "practitioner" ? "/practitioner-dashboard" : "/client-dashboard",
    locale,
  });
  return null;
}
