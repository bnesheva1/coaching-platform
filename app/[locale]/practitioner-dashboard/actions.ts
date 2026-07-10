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
const MAX_BIO_LENGTH = 1000;
const KNOWN_SPECIALTY_KEYS = new Set(specialtiesData.map((s) => s.key));

// The DB only shape-checks the timezone column (same philosophy as the
// specialties fix) — this is the actual correctness check, using the
// same mechanism the timezone will be used with later (Intl-based
// conversion), rather than maintaining a separate list of valid IANA
// identifiers. Throws on a bogus zone, which is exactly what we want to
// catch.
function isValidTimezone(candidate: string): boolean {
  try {
    Intl.DateTimeFormat(undefined, { timeZone: candidate });
    return true;
  } catch {
    return false;
  }
}

export async function saveProfile(
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

  const displayName = (formData.get("displayName") as string).trim();
  const rawUsername = formData.get("username") as string;
  const bio = (formData.get("bio") as string).trim();
  const timezone = (formData.get("timezone") as string)?.trim();
  // Checkboxes are rendered from the known specialty list, but a raw
  // request could submit anything as a value — filter to the actual
  // taxonomy so junk/spam text can't end up displayed on a public
  // profile as if it were a real specialty.
  const specialties = (formData.getAll("specialties") as string[]).filter((key) =>
    KNOWN_SPECIALTY_KEYS.has(key),
  );

  if (displayName.length > MAX_DISPLAY_NAME_LENGTH) {
    return { error: t("displayNameTooLong", { max: MAX_DISPLAY_NAME_LENGTH }) };
  }
  if (bio.length > MAX_BIO_LENGTH) {
    return { error: t("bioTooLong", { max: MAX_BIO_LENGTH }) };
  }
  if (!timezone || !isValidTimezone(timezone)) {
    return { error: t("timezoneInvalid") };
  }

  const avatarEntry = formData.get("avatar");
  const avatarFile =
    avatarEntry instanceof File && avatarEntry.size > 0 ? avatarEntry : null;

  const payload: {
    id: string;
    bio: string;
    specialties: string[];
    timezone: string;
    avatar_url?: string;
    username?: string;
  } = {
    id: user.id,
    bio,
    specialties,
    timezone,
  };

  // Left blank, username is simply not touched — a practitioner without
  // one yet is a valid, expected state, not an error.
  if (rawUsername.trim()) {
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

    payload.username = usernameResult.normalized;
  }

  if (avatarFile) {
    if (!ALLOWED_AVATAR_TYPES.includes(avatarFile.type)) {
      return { error: t("photoInvalidType") };
    }
    if (avatarFile.size > MAX_AVATAR_BYTES) {
      return { error: t("photoTooLarge") };
    }

    // Fixed path per user (no extension) so re-uploading always overwrites
    // the same object instead of accumulating old files.
    const path = `${user.id}/avatar`;
    const { error: uploadError } = await supabase.storage
      .from("avatars")
      .upload(path, avatarFile, {
        upsert: true,
        contentType: avatarFile.type,
      });

    if (uploadError) {
      return { error: t("photoUploadFailed", { message: uploadError.message }) };
    }

    const {
      data: { publicUrl },
    } = supabase.storage.from("avatars").getPublicUrl(path);

    // Cache-bust: the path never changes, so without this the browser
    // (or a CDN) may keep showing the old photo after it's replaced.
    payload.avatar_url = `${publicUrl}?t=${Date.now()}`;
  }

  const { error: displayNameError } = await supabase
    .from("profiles")
    .update({ display_name: displayName })
    .eq("id", user.id);

  if (displayNameError) {
    console.error("saveProfile: failed to update display_name:", displayNameError);
    return { error: t("saveFailed") };
  }

  const { error } = await supabase
    .from("practitioner_profiles")
    .upsert(payload);

  if (error) {
    console.error("saveProfile: failed to upsert practitioner_profiles:", error);
    return { error: t("saveFailed") };
  }

  revalidatePath("/practitioner-dashboard");
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
