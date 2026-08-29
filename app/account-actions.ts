"use server";

import { getTranslations, getLocale } from "next-intl/server";
import { redirect } from "@/i18n/navigation";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/serviceRole";
import { getUpcomingBookingCountForUser } from "@/lib/services/bookingLock";
import { checkRateLimit, changePasswordLimiter } from "@/lib/rate-limit";
import { purgeUploadedDocumentsForUser } from "@/lib/documents/gdpr";

// Locale-independent (lives outside app/[locale], same precedent as
// cookie-consent-actions.ts) — both actions here operate on "whoever is
// logged in," identically regardless of which dashboard's settings page
// called them.

export async function updateMarketingConsent(consent: boolean): Promise<{ success: boolean }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { success: false };

  const { error } = await supabase
    .from("profiles")
    .update({ marketing_consent: consent, marketing_consent_updated_at: new Date().toISOString() })
    .eq("id", user.id);

  if (error) {
    console.error("updateMarketingConsent failed:", error);
    return { success: false };
  }
  return { success: true };
}

export type ChangePasswordFormState = { error?: string; success?: boolean } | null;

// Requires re-entering the CURRENT password, verified via a real
// signInWithPassword call, before accepting the new one — Supabase's
// own auth.updateUser() would happily change the password of any live
// session with no such check, but that's the wrong boundary for this
// specific action: a hijacked-but-unattended session (shared computer,
// stolen token) is exactly the scenario a password change is meant to
// lock out, and skipping this check would let that same attacker lock
// the real owner out permanently instead. Matches how every mainstream
// app (GitHub, Google, ...) treats this, unlike account deletion above,
// which intentionally has no equivalent friction beyond the typed-name
// match (deletion can't be "used against you" the same way — the worst
// case there is just that it happened, not that someone else now
// controls the account going forward).
export async function changePassword(
  _prevState: ChangePasswordFormState,
  formData: FormData,
): Promise<ChangePasswordFormState> {
  const t = await getTranslations("AccountSettings");
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user || !user.email) {
    return { error: t("changePasswordGenericError") };
  }

  const { success: withinLimit } = await checkRateLimit(changePasswordLimiter, user.id);
  if (!withinLimit) {
    return { error: t("changePasswordTooManyAttempts") };
  }

  const currentPassword = (formData.get("currentPassword") as string) ?? "";
  const newPassword = (formData.get("newPassword") as string) ?? "";
  const confirmNewPassword = (formData.get("confirmNewPassword") as string) ?? "";

  if (newPassword.length < 12) {
    return { error: t("changePasswordTooShort") };
  }
  if (newPassword !== confirmNewPassword) {
    return { error: t("changePasswordMismatch") };
  }

  // Re-authentication — this is the actual "prove you know the current
  // password" check. Reuses the exact same call the login form itself
  // makes; a wrong current password fails here exactly like a wrong
  // login attempt would, before anything is changed.
  const { error: reauthError } = await supabase.auth.signInWithPassword({
    email: user.email,
    password: currentPassword,
  });
  if (reauthError) {
    return { error: t("changePasswordCurrentIncorrect") };
  }

  const { error: updateError } = await supabase.auth.updateUser({ password: newPassword });
  if (updateError) {
    console.error("changePassword: updateUser failed", { userId: user.id, error: updateError });
    return { error: t("changePasswordGenericError") };
  }

  return { success: true };
}

export type DeleteAccountFormState = { error?: string } | null;

// Anonymise, never hard-delete — a real DELETE would cascade through
// bookings/reviews/payments the OTHER party still needs their own
// record of. See the migration comment on profiles.deleted_at for the
// full reasoning; this function is the one place that column is ever
// written.
//
// Ordering deliberately matters: every data-scrub step runs BEFORE the
// auth-disable step. If something fails partway, "profile not yet
// scrubbed but login still works" is a safely-retryable state (the user
// can just try again); "login disabled but profile still has real PII"
// is not — they'd have no way to retry through the UI at all once
// signed out. Doing the irreversible access-cutoff last minimizes the
// chance of landing in the worse of the two stuck states.
//
// The confirmation-text match (typed display name === actual display
// name) is enforced client-side only, deliberately not re-checked here
// — it's a "make sure this is really you, on purpose" friction step,
// not a security boundary. auth.getUser() below already scopes this
// entire action to the caller's own account regardless of what they
// typed; there's no privileged action a wrong guess could unlock.
export async function deleteMyAccount(
  _prevState: DeleteAccountFormState,
  _formData: FormData,
): Promise<DeleteAccountFormState> {
  const t = await getTranslations("AccountSettings");
  const locale = await getLocale();
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect({ href: "/login", locale });
    return null;
  }

  const upcomingCount = await getUpcomingBookingCountForUser(supabase, user.id);
  if (upcomingCount > 0) {
    return { error: t("deleteAccountUpcomingBookingsBlock") };
  }

  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single();
  const serviceSupabase = createServiceRoleClient();

  try {
    if (profile?.role === "practitioner") {
      // bio is deliberately included even though it's set to the same
      // null it might already be — practitioner_profiles_search_sync
      // fires on "update of bio", which is what clears this account out
      // of search results as a side effect, no separate step needed.
      const { error: practitionerErr } = await serviceSupabase
        .from("practitioner_profiles")
        .update({
          bio: null,
          headline: null,
          location: null,
          avatar_url: null,
          banner_url: null,
          username: null,
          specialties: [],
          topics: [],
          stripe_connected_account_id: null,
        })
        .eq("id", user.id);
      if (practitionerErr) throw practitionerErr;

      // Hidden, not deleted — a hard delete would cascade through
      // bookings via services' own FK, destroying the exact history
      // this whole approach is designed to keep. Same mechanism
      // setServiceActive already uses to hide a service from new
      // bookings without touching its rows.
      const { error: servicesErr } = await serviceSupabase
        .from("services")
        .update({ is_active: false })
        .eq("practitioner_id", user.id);
      if (servicesErr) throw servicesErr;
    }

    // A fixed, locale-neutral marker rather than a translated string —
    // deliberately not read from `t(...)`. The viewer's own locale (not
    // the deleted user's) is what should determine display language
    // everywhere else in this app, and this stored value has no way to
    // know who's looking at it later. Matches exactly how the task that
    // requested this described it: bookings "become 'deleted user'".
    const { error: profileErr } = await serviceSupabase
      .from("profiles")
      .update({ display_name: "Deleted user", email: null, deleted_at: new Date().toISOString() })
      .eq("id", user.id);
    if (profileErr) throw profileErr;

    // Purge the documents this user UPLOADED (files + metadata rows) and
    // anonymise their entries in the document event log. The counterparty's
    // documents on shared bookings are left untouched (their content; they
    // expire via retention). Best-effort — logged, never throws — so a
    // storage hiccup can't strand the account anonymisation above.
    await purgeUploadedDocumentsForUser(serviceSupabase, user.id);
  } catch (err) {
    console.error("deleteMyAccount: data scrub failed, auth NOT disabled", { userId: user.id, err });
    return { error: t("deleteAccountGenericError") };
  }

  try {
    // Scrubs the identifying email in auth.users itself too — profiles.email
    // is only a denormalized copy of this. A per-user-unique placeholder
    // (not a shared fixed address) so this can never collide across
    // multiple deleted accounts.
    const { error: emailErr } = await serviceSupabase.auth.admin.updateUserById(user.id, {
      email: `deleted-${user.id}@deleted.invalid`,
      user_metadata: {},
    });
    if (emailErr) throw emailErr;

    // Soft delete, not hard delete — sets deleted_at on auth.users
    // (GoTrue rejects future sign-ins once it's set) while keeping the
    // row itself, so profiles.id's FK to it stays valid instead of
    // cascading. This is the same mechanism already relied on for
    // throwaway test-account cleanup earlier in this project's history.
    const { error: deleteErr } = await serviceSupabase.auth.admin.deleteUser(user.id, true);
    if (deleteErr) throw deleteErr;
  } catch (err) {
    // Data is already scrubbed at this point — the account is
    // effectively anonymised even if this last step didn't complete.
    // Logged loudly for manual follow-up (a real admin soft-deleting
    // this user by hand) rather than surfaced to the user, who has no
    // way to retry a step this far in anyway.
    console.error("deleteMyAccount: data scrubbed but auth disable failed — needs manual follow-up", {
      userId: user.id,
      err,
    });
  }

  // Clears the current browser's own session cookie immediately,
  // regardless of whether the soft-delete call above succeeded.
  await supabase.auth.signOut();

  redirect({ href: "/account-deleted", locale });
  return null;
}
