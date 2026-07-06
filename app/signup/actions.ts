"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export type AuthFormState = { error: string } | null;

export async function signup(
  _prevState: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const email = formData.get("email") as string;
  const password = formData.get("password") as string;
  const fullName = formData.get("fullName") as string;
  const role = formData.get("role") as string;

  if (password.length < 12) {
    return { error: "Password must be at least 12 characters." };
  }

  const supabase = await createClient();

  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: { full_name: fullName, role },
    },
  });

  if (error) {
    return { error: error.message };
  }

  // If email confirmation is disabled on the Supabase project, signUp
  // returns an active session immediately — otherwise the user has to
  // click the confirmation link first.
  if (data.session) {
    redirect("/");
  }

  redirect("/signup/check-email");
}
