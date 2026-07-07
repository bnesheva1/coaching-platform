"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { validateUsernameFormat } from "@/lib/validation/username";

export type AuthFormState = { error: string } | null;

export async function signup(
  _prevState: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const email = formData.get("email") as string;
  const password = formData.get("password") as string;
  const rawUsername = formData.get("username") as string;
  const role = formData.get("role") as string;

  if (password.length < 12) {
    return { error: "Password must be at least 12 characters." };
  }

  // Full validation on submit — the live check the user saw while typing
  // is a UX aid only and must not be trusted as the real gate.
  const usernameResult = validateUsernameFormat(rawUsername);
  if (!usernameResult.valid) {
    return { error: usernameResult.reason };
  }

  const supabase = await createClient();

  // Re-check availability right before submitting. This closes the gap
  // between whatever the live check last reported and this exact moment
  // (e.g. someone submits fast without waiting for it) with a clean,
  // specific error — tested empirically against a real duplicate-username
  // signup, Supabase does NOT return a useful, parseable error message for
  // a trigger-level unique-constraint failure (it comes back as an
  // AuthRetryableFetchError with an empty body), so catching it here
  // instead is what actually gives a good message in practice.
  const { data: taken } = await supabase.rpc("is_username_taken", {
    candidate: usernameResult.normalized,
  });
  if (taken) {
    return { error: "That username is already taken." };
  }

  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: { username: usernameResult.normalized, role },
    },
  });

  if (error) {
    // The database's case-insensitive unique index on username is still
    // the ultimate guarantee — it's what would catch a true race condition
    // (two people submitting the exact same username in the same instant,
    // both passing the check above). That's rare enough, and the error
    // Supabase returns for it opaque enough, that we stay honest about the
    // ambiguity rather than confidently mislabeling every failure here as
    // a username conflict.
    return {
      error:
        "Something went wrong creating your account. If you picked a username that someone just took, try a different one.",
    };
  }

  // If email confirmation is disabled on the Supabase project, signUp
  // returns an active session immediately — otherwise the user has to
  // click the confirmation link first.
  if (data.session) {
    redirect(
      role === "practitioner" ? "/practitioner-dashboard" : "/client-dashboard",
    );
  }

  redirect("/signup/check-email");
}

export type UsernameAvailability =
  | { available: true }
  | { available: false; reason: string };

export async function checkUsernameAvailability(
  rawUsername: string,
): Promise<UsernameAvailability> {
  const result = validateUsernameFormat(rawUsername);
  if (!result.valid) {
    return { available: false, reason: result.reason };
  }

  const supabase = await createClient();
  const { data: taken, error } = await supabase.rpc("is_username_taken", {
    candidate: result.normalized,
  });

  if (error) {
    return { available: false, reason: "Couldn't check availability right now." };
  }

  return taken
    ? { available: false, reason: "That username is already taken." }
    : { available: true };
}
