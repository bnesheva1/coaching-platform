"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { validateUsernameFormat } from "@/lib/validation/username";

export type ProfileFormState = { error?: string; success?: boolean } | null;

const MAX_AVATAR_BYTES = 2 * 1024 * 1024; // 2MB, matches the bucket's own limit
const ALLOWED_AVATAR_TYPES = ["image/png", "image/jpeg", "image/webp"];

export async function saveProfile(
  _prevState: ProfileFormState,
  formData: FormData,
): Promise<ProfileFormState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { error: "Not logged in." };
  }

  const displayName = formData.get("displayName") as string;
  const rawUsername = formData.get("username") as string;
  const bio = formData.get("bio") as string;
  const specialties = formData.getAll("specialties") as string[];

  const avatarEntry = formData.get("avatar");
  const avatarFile =
    avatarEntry instanceof File && avatarEntry.size > 0 ? avatarEntry : null;

  const payload: {
    id: string;
    bio: string;
    specialties: string[];
    avatar_url?: string;
    username?: string;
  } = {
    id: user.id,
    bio,
    specialties,
  };

  // Left blank, username is simply not touched — a practitioner without
  // one yet is a valid, expected state, not an error.
  if (rawUsername.trim()) {
    const usernameResult = validateUsernameFormat(rawUsername);
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
      return { error: "That username is already taken." };
    }

    payload.username = usernameResult.normalized;
  }

  if (avatarFile) {
    if (!ALLOWED_AVATAR_TYPES.includes(avatarFile.type)) {
      return { error: "Photo must be a PNG, JPEG, or WebP image." };
    }
    if (avatarFile.size > MAX_AVATAR_BYTES) {
      return { error: "Photo must be smaller than 2MB." };
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
      return { error: `Photo upload failed: ${uploadError.message}` };
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
    return { error: displayNameError.message };
  }

  const { error } = await supabase
    .from("practitioner_profiles")
    .upsert(payload);

  if (error) {
    return { error: error.message };
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
  const result = validateUsernameFormat(rawUsername);
  if (!result.valid) {
    return { available: false, reason: result.reason };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { available: false, reason: "Not logged in." };
  }

  const { data: taken, error } = await supabase.rpc("is_username_taken", {
    candidate: result.normalized,
    exclude_id: user.id,
  });

  if (error) {
    return { available: false, reason: "Couldn't check availability right now." };
  }

  return taken
    ? { available: false, reason: "That username is already taken." }
    : { available: true };
}
