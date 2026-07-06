"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

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
  } = {
    id: user.id,
    bio,
    specialties,
  };

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

  const { error } = await supabase
    .from("practitioner_profiles")
    .upsert(payload);

  if (error) {
    return { error: error.message };
  }

  revalidatePath("/practitioner-dashboard");
  return { success: true };
}
