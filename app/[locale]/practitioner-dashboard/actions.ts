"use server";

import { revalidatePath } from "next/cache";
import { getTranslations } from "next-intl/server";
import { createClient } from "@/lib/supabase/server";
import { validateUsernameFormat } from "@/lib/validation/username";
import specialtiesData from "@/data/specialties.json";

export type ProfileFormState = { error?: string; success?: boolean } | null;

const MAX_AVATAR_BYTES = 2 * 1024 * 1024; // 2MB, matches the bucket's own limit
const ALLOWED_AVATAR_TYPES = ["image/png", "image/jpeg", "image/webp"];
const MAX_DISPLAY_NAME_LENGTH = 100;
const MAX_HEADLINE_LENGTH = 150;
const MAX_LOCATION_LENGTH = 100;
const MAX_BIO_LENGTH = 1000;
const KNOWN_SPECIALTY_KEYS = new Set(specialtiesData.map((s) => s.key));

// "layout" — the dashboard is a shared layout + six pages; this
// invalidates the layout and every page beneath it, not just the
// literal path a plain page-type revalidation would target (see the
// identical comment in availability-actions.ts).
function revalidateDashboard() {
  revalidatePath("/practitioner-dashboard", "layout");
}

// Was one big saveProfile() upserting every practitioner_profiles column
// at once from a single form. Now split into column-scoped actions
// (this file) plus updateScheduleSettings (schedule-settings-actions.ts)
// because the fields live in different places now: inline pencils on
// the profile view, a settings box, and the Schedule tab. Each action
// below only ever touches its own columns — safe to split because the
// row already exists (created at signup), so every one of these hits
// the update path, never insert, and Postgres upsert/update only
// touches columns present in its own payload, leaving the rest alone.

// Backs both the "identity" pencil (name/headline/location) and the
// "About" pencil (bio) — same action, each form only submits the
// field(s) it owns; only fields present in the FormData get updated.
export async function updateProfileText(
  _prevState: ProfileFormState,
  formData: FormData,
): Promise<ProfileFormState> {
  const t = await getTranslations("Profile");
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { error: t("notLoggedIn") };
  }

  if (formData.has("displayName")) {
    const displayName = (formData.get("displayName") as string).trim();
    if (displayName.length > MAX_DISPLAY_NAME_LENGTH) {
      return { error: t("displayNameTooLong", { max: MAX_DISPLAY_NAME_LENGTH }) };
    }
    const { error } = await supabase.from("profiles").update({ display_name: displayName }).eq("id", user.id);
    if (error) {
      console.error("updateProfileText: failed to update display_name:", error);
      return { error: t("saveFailed") };
    }
  }

  const practitionerPayload: { headline?: string; location?: string; bio?: string } = {};

  if (formData.has("headline")) {
    const headline = (formData.get("headline") as string).trim();
    if (headline.length > MAX_HEADLINE_LENGTH) {
      return { error: t("headlineTooLong", { max: MAX_HEADLINE_LENGTH }) };
    }
    practitionerPayload.headline = headline;
  }
  if (formData.has("location")) {
    const location = (formData.get("location") as string).trim();
    if (location.length > MAX_LOCATION_LENGTH) {
      return { error: t("locationTooLong", { max: MAX_LOCATION_LENGTH }) };
    }
    practitionerPayload.location = location;
  }
  if (formData.has("bio")) {
    const bio = (formData.get("bio") as string).trim();
    if (bio.length > MAX_BIO_LENGTH) {
      return { error: t("bioTooLong", { max: MAX_BIO_LENGTH }) };
    }
    practitionerPayload.bio = bio;
  }

  if (Object.keys(practitionerPayload).length > 0) {
    const { error } = await supabase.from("practitioner_profiles").update(practitionerPayload).eq("id", user.id);
    if (error) {
      console.error("updateProfileText: failed to update practitioner_profiles:", error);
      return { error: t("saveFailed") };
    }
  }

  revalidateDashboard();
  return { success: true };
}

export async function updateSpecialties(
  _prevState: ProfileFormState,
  formData: FormData,
): Promise<ProfileFormState> {
  const t = await getTranslations("Profile");
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { error: t("notLoggedIn") };
  }

  // Checkboxes are rendered from the known specialty list, but a raw
  // request could submit anything as a value — filter to the actual
  // taxonomy so junk/spam text can't end up displayed on a public
  // profile as if it were a real specialty.
  const specialties = (formData.getAll("specialties") as string[]).filter((key) => KNOWN_SPECIALTY_KEYS.has(key));

  const { error } = await supabase.from("practitioner_profiles").update({ specialties }).eq("id", user.id);
  if (error) {
    console.error("updateSpecialties failed:", error);
    return { error: t("saveFailed") };
  }

  revalidateDashboard();
  return { success: true };
}

export async function updateUsername(
  _prevState: ProfileFormState,
  formData: FormData,
): Promise<ProfileFormState> {
  const t = await getTranslations("Profile");
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { error: t("notLoggedIn") };
  }

  const rawUsername = (formData.get("username") as string) ?? "";
  if (!rawUsername.trim()) {
    return { error: t("usernameTooShort", { min: 3 }) };
  }

  const usernameResult = await validateUsernameFormat(rawUsername);
  if (!usernameResult.valid) {
    return { error: usernameResult.reason };
  }

  // Exclude our own row — re-saving your own unchanged username must
  // not report itself as taken.
  const { data: taken } = await supabase.rpc("is_username_taken", {
    candidate: usernameResult.normalized,
    exclude_id: user.id,
  });
  if (taken) {
    return { error: t("usernameAlreadyTaken") };
  }

  const { error } = await supabase
    .from("practitioner_profiles")
    .update({ username: usernameResult.normalized })
    .eq("id", user.id);
  if (error) {
    console.error("updateUsername failed:", error);
    return { error: t("saveFailed") };
  }

  revalidateDashboard();
  return { success: true };
}

// Generalized from the old avatar-only upload block — same bucket, same
// size/type checks, same cache-busting suffix, just parameterized by
// which image this is so the same code serves both the avatar pencil
// and the banner pencil. Storage path becomes "<user id>/<kind>",
// already permitted by the avatars bucket's existing policies (scoped
// to "own folder", not to a specific filename).
export async function uploadProfileImage(
  kind: "avatar" | "banner",
  _prevState: ProfileFormState,
  formData: FormData,
): Promise<ProfileFormState> {
  const t = await getTranslations("Profile");
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { error: t("notLoggedIn") };
  }

  const imageEntry = formData.get("image");
  const imageFile = imageEntry instanceof File && imageEntry.size > 0 ? imageEntry : null;
  if (!imageFile) {
    return { error: t("photoInvalidType") };
  }
  if (!ALLOWED_AVATAR_TYPES.includes(imageFile.type)) {
    return { error: t("photoInvalidType") };
  }
  if (imageFile.size > MAX_AVATAR_BYTES) {
    return { error: t("photoTooLarge") };
  }

  const path = `${user.id}/${kind}`;
  const { error: uploadError } = await supabase.storage.from("avatars").upload(path, imageFile, {
    upsert: true,
    contentType: imageFile.type,
  });
  if (uploadError) {
    return { error: t("photoUploadFailed", { message: uploadError.message }) };
  }

  const {
    data: { publicUrl },
  } = supabase.storage.from("avatars").getPublicUrl(path);
  // Cache-bust: the path never changes, so without this the browser
  // (or a CDN) may keep showing the old image after it's replaced.
  const cacheBustedUrl = `${publicUrl}?t=${Date.now()}`;

  const column = kind === "avatar" ? "avatar_url" : "banner_url";
  const { error } = await supabase.from("practitioner_profiles").update({ [column]: cacheBustedUrl }).eq("id", user.id);
  if (error) {
    console.error("uploadProfileImage failed:", error);
    return { error: t("saveFailed") };
  }

  revalidateDashboard();
  return { success: true };
}

export type UsernameAvailability =
  | { available: true }
  | { available: false; reason: string };

export async function checkUsernameAvailability(
  rawUsername: string,
): Promise<UsernameAvailability> {
  const t = await getTranslations("Profile");
  const result = await validateUsernameFormat(rawUsername);
  if (!result.valid) {
    return { available: false, reason: result.reason };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { available: false, reason: t("notLoggedIn") };
  }

  const { data: taken, error } = await supabase.rpc("is_username_taken", {
    candidate: result.normalized,
    exclude_id: user.id,
  });

  if (error) {
    return { available: false, reason: t("availabilityCheckFailed") };
  }

  return taken
    ? { available: false, reason: t("usernameAlreadyTaken") }
    : { available: true };
}
