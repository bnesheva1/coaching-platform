"use server";

import { revalidatePath } from "next/cache";
import { getTranslations, getLocale } from "next-intl/server";
import { createClient } from "@/lib/supabase/server";
import { validateUsernameFormat } from "@/lib/validation/username";
import { getRenameUsage, recordRename, formatRenameDate } from "@/lib/rename-limits";
import { createServiceRoleClient } from "@/lib/supabase/serviceRole";
import specialtiesData from "@/data/specialties.json";
import topicsData from "@/data/topics.json";

// values echoes back whatever text fields were actually submitted, on
// an error return only — React 19 resets a <form action={...}> after
// ANY action completion (success or failure), which wipes plain
// defaultValue fields back to their pre-edit values, not just the one
// that was actually invalid. The caller re-keys its <form> off this
// object's identity to force a remount with these as the new
// defaultValues, so a rejected submission redisplays what was typed
// instead of discarding it. Only used by updateProfileText today, but
// shared on this broad type rather than a narrower one-off, same
// precedent as ServiceFormState being shared across create/update.
export type ProfileFormState = { error?: string; success?: boolean; values?: Record<string, string> } | null;

const MAX_AVATAR_BYTES = 2 * 1024 * 1024; // 2MB, matches the bucket's own limit
const ALLOWED_AVATAR_TYPES = ["image/png", "image/jpeg", "image/webp"];
const MAX_DISPLAY_NAME_LENGTH = 100;
const MAX_HEADLINE_LENGTH = 150;
const MAX_LOCATION_LENGTH = 100;
const MAX_BIO_LENGTH = 1000;
// Gallery: up to 3 images, each with an optional <=100-char plain-text caption.
// The UI enforces both too; these are the authoritative checks for a direct API
// call, and the 3-image cap is ALSO enforced by a DB trigger (see migration
// 20260905120000) so a race can't exceed it.
const MAX_GALLERY_IMAGES = 3;
const MAX_GALLERY_CAPTION_LENGTH = 100;
const KNOWN_SPECIALTY_KEYS = new Set(specialtiesData.map((s) => s.key));
const KNOWN_TOPIC_KEYS = new Set(topicsData.map((topic) => topic.key));
// A curated handful reads as focused — see EditableTopics.tsx's own
// identical constant/comment. The UI already disables further chips at
// this count; this is the authoritative check for a direct API call
// that skips the UI entirely.
const MAX_TOPICS = 3;

// "layout" — the dashboard is a shared layout + six pages; this
// invalidates the layout and every page beneath it, not just the
// literal path a plain page-type revalidation would target (see the
// identical comment in availability-actions.ts).
function revalidateDashboard() {
  revalidatePath("/practitioner-dashboard", "layout");
}

// Was one big saveProfile() upserting every practitioner_profiles column
// at once from a single form. Now split into column-scoped actions
// (this file) plus updateTimezone/updateMinNoticeHours
// (schedule-settings-actions.ts) because the fields live in different
// places now: inline pencils on the profile view, a settings box, and
// the Schedule tab. Each action
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

  // Whatever text fields this particular caller submitted (only
  // displayName for EditableIdentity's own submit, all three for
  // EditableIdentity, just bio for EditableAbout) — echoed back on
  // every error return below so a rejected submission can redisplay
  // what was actually typed instead of the pre-edit value. See
  // ProfileFormState's own comment for why this is necessary at all.
  const submittedValues: Record<string, string> = {};
  for (const key of ["displayName", "headline", "location", "bio"]) {
    if (formData.has(key)) submittedValues[key] = (formData.get(key) as string).trim();
  }

  if (formData.has("displayName")) {
    const displayName = (formData.get("displayName") as string).trim();
    if (displayName.length > MAX_DISPLAY_NAME_LENGTH) {
      return { error: t("displayNameTooLong", { max: MAX_DISPLAY_NAME_LENGTH }), values: submittedValues };
    }
    // Only a real change counts against the limit / is logged — re-saving
    // the identity form after editing only the headline must not burn a
    // name-change slot.
    const { data: currentProfile } = await supabase.from("profiles").select("display_name").eq("id", user.id).single();
    const currentName = currentProfile?.display_name ?? "";
    if (displayName !== currentName) {
      const usage = await getRenameUsage(user.id, "practitioner_display_name");
      if (usage.remaining <= 0) {
        const locale = await getLocale();
        return {
          error: usage.nextAllowedAt
            ? t("renameLimitReached", { date: formatRenameDate(usage.nextAllowedAt, locale) })
            : t("saveFailed"),
          values: submittedValues,
        };
      }
      const { error } = await supabase.from("profiles").update({ display_name: displayName }).eq("id", user.id);
      if (error) {
        console.error("updateProfileText: failed to update display_name:", error);
        return { error: t("saveFailed"), values: submittedValues };
      }
      await recordRename(user.id, "display_name", currentName || null, displayName);
    }
  }

  const practitionerPayload: { headline?: string; location?: string; bio?: string } = {};

  if (formData.has("headline")) {
    const headline = (formData.get("headline") as string).trim();
    if (headline.length > MAX_HEADLINE_LENGTH) {
      return { error: t("headlineTooLong", { max: MAX_HEADLINE_LENGTH }), values: submittedValues };
    }
    practitionerPayload.headline = headline;
  }
  if (formData.has("location")) {
    const location = (formData.get("location") as string).trim();
    if (location.length > MAX_LOCATION_LENGTH) {
      return { error: t("locationTooLong", { max: MAX_LOCATION_LENGTH }), values: submittedValues };
    }
    practitionerPayload.location = location;
  }
  if (formData.has("bio")) {
    const bio = (formData.get("bio") as string).trim();
    if (bio.length > MAX_BIO_LENGTH) {
      return { error: t("bioTooLong", { max: MAX_BIO_LENGTH }), values: submittedValues };
    }
    practitionerPayload.bio = bio;
  }

  if (Object.keys(practitionerPayload).length > 0) {
    const { error } = await supabase.from("practitioner_profiles").update(practitionerPayload).eq("id", user.id);
    if (error) {
      console.error("updateProfileText: failed to update practitioner_profiles:", error);
      return { error: t("saveFailed"), values: submittedValues };
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

export async function updateTopics(
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

  // Same reasoning as updateSpecialties — checkboxes render from the
  // known taxonomy, but a raw request could submit anything, so filter
  // to it here rather than trusting the client.
  const topics = (formData.getAll("topics") as string[]).filter((key) => KNOWN_TOPIC_KEYS.has(key));
  if (topics.length > MAX_TOPICS) {
    return { error: t("topicsMaxExceeded", { max: MAX_TOPICS }) };
  }

  const { error } = await supabase.from("practitioner_profiles").update({ topics }).eq("id", user.id);
  if (error) {
    console.error("updateTopics failed:", error);
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

  // Format + reserved-word + profanity checks — the SAME validation the
  // signup/creation path runs, deliberately re-run here so a username
  // CHANGE can't slip a reserved or profane handle past.
  const usernameResult = await validateUsernameFormat(rawUsername);
  if (!usernameResult.valid) {
    return { error: usernameResult.reason };
  }

  // An unchanged resubmit is a no-op — no limit consumed, no log entry.
  const { data: currentRow } = await supabase.from("practitioner_profiles").select("username").eq("id", user.id).single();
  const current = currentRow?.username ?? null;
  if (current === usernameResult.normalized) {
    return { success: true };
  }

  // Server-side rate limit (1 / 90 days), before any mutation.
  const usage = await getRenameUsage(user.id, "username");
  if (usage.remaining <= 0) {
    const locale = await getLocale();
    return {
      error: usage.nextAllowedAt
        ? t("renameLimitReached", { date: formatRenameDate(usage.nextAllowedAt, locale) })
        : t("saveFailed"),
    };
  }

  // Taken by another practitioner — live, or a still-redirecting past
  // handle of theirs (the reclaim guard). exclude_id lets us reclaim our
  // own old handle.
  const { data: taken } = await supabase.rpc("is_username_taken", {
    candidate: usernameResult.normalized,
    exclude_id: user.id,
  });
  if (taken) {
    return { error: t("usernameAlreadyTaken") };
  }

  // Park the old handle in history first (so it keeps redirecting even if
  // the update below fails — the old handle stays live in that case, which
  // is harmless), reclaim the new handle from our own history if we'd
  // parked it before, then set the live username. username_history is a
  // locked table, so these go through the service role.
  const admin = createServiceRoleClient();
  if (current) {
    const { error: histError } = await admin
      .from("username_history")
      .upsert(
        { practitioner_id: user.id, username: current, released_at: new Date().toISOString() },
        { onConflict: "username" },
      );
    if (histError) {
      console.error("updateUsername: history upsert failed:", histError);
      return { error: t("saveFailed") };
    }
  }
  await admin.from("username_history").delete().eq("practitioner_id", user.id).eq("username", usernameResult.normalized);

  const { error } = await supabase
    .from("practitioner_profiles")
    .update({ username: usernameResult.normalized })
    .eq("id", user.id);
  if (error) {
    console.error("updateUsername failed:", error);
    return { error: t("saveFailed") };
  }

  await recordRename(user.id, "username", current, usernameResult.normalized);
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

// The removal counterpart — clears the column and best-effort deletes
// the underlying storage object (same deterministic "<user id>/<kind>"
// path uploadProfileImage writes to). A failed storage delete doesn't
// block clearing the column: an orphaned file in the bucket is a much
// smaller problem than a stuck "can't remove my photo" UI, and the
// column is what every reader (this profile, Browse, etc.) actually
// looks at.
export async function removeProfileImage(kind: "avatar" | "banner"): Promise<ProfileFormState> {
  const t = await getTranslations("Profile");
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { error: t("notLoggedIn") };
  }

  const { error: deleteError } = await supabase.storage.from("avatars").remove([`${user.id}/${kind}`]);
  if (deleteError) {
    console.error("removeProfileImage: failed to delete storage object", { kind, deleteError });
  }

  const column = kind === "avatar" ? "avatar_url" : "banner_url";
  const { error } = await supabase.from("practitioner_profiles").update({ [column]: null }).eq("id", user.id);
  if (error) {
    console.error("removeProfileImage failed:", error);
    return { error: t("saveFailed") };
  }

  revalidateDashboard();
  return { success: true };
}

// ---- Gallery (up to 3 images + optional captions, shown after About) ----

// Add one gallery image (+ optional caption). Rejects once the practitioner
// already has MAX_GALLERY_IMAGES; the image goes to the same public `avatars`
// bucket every other profile image uses, under the owner's own folder at a
// unique `gallery-<uuid>` path (so multiple images never collide the way the
// fixed avatar/banner paths would).
export async function addGalleryImage(
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

  // Count first so we don't upload a file we're about to reject. The DB trigger
  // is the real backstop; this gives a friendly message instead of a raw throw.
  const { count, error: countError } = await supabase
    .from("practitioner_gallery")
    .select("id", { count: "exact", head: true })
    .eq("practitioner_id", user.id);
  if (countError) {
    console.error("addGalleryImage: count failed", countError);
    return { error: t("saveFailed") };
  }
  const existing = count ?? 0;
  if (existing >= MAX_GALLERY_IMAGES) {
    return { error: t("galleryLimitReached", { max: MAX_GALLERY_IMAGES }) };
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

  const rawCaption = ((formData.get("caption") as string) ?? "").trim();
  if (rawCaption.length > MAX_GALLERY_CAPTION_LENGTH) {
    return { error: t("galleryCaptionTooLong", { max: MAX_GALLERY_CAPTION_LENGTH }) };
  }
  const caption = rawCaption === "" ? null : rawCaption;

  const path = `${user.id}/gallery-${crypto.randomUUID()}`;
  const { error: uploadError } = await supabase.storage.from("avatars").upload(path, imageFile, {
    upsert: false,
    contentType: imageFile.type,
  });
  if (uploadError) {
    return { error: t("photoUploadFailed", { message: uploadError.message }) };
  }

  const {
    data: { publicUrl },
  } = supabase.storage.from("avatars").getPublicUrl(path);

  const { error } = await supabase.from("practitioner_gallery").insert({
    practitioner_id: user.id,
    storage_path: path,
    image_url: publicUrl,
    caption,
    // Append after any existing images.
    position: existing,
  });
  if (error) {
    // Roll back the just-uploaded file so a failed insert doesn't orphan it.
    await supabase.storage.from("avatars").remove([path]).catch(() => {});
    console.error("addGalleryImage: insert failed", error);
    return { error: t("saveFailed") };
  }

  revalidateDashboard();
  return { success: true };
}

// Edit just the caption of an existing gallery image (id bound by the caller).
export async function updateGalleryCaption(
  id: string,
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

  const rawCaption = ((formData.get("caption") as string) ?? "").trim();
  if (rawCaption.length > MAX_GALLERY_CAPTION_LENGTH) {
    return { error: t("galleryCaptionTooLong", { max: MAX_GALLERY_CAPTION_LENGTH }) };
  }
  const caption = rawCaption === "" ? null : rawCaption;

  // RLS also scopes this to the owner; the practitioner_id filter makes the
  // ownership explicit and means a wrong id simply updates nothing.
  const { error } = await supabase
    .from("practitioner_gallery")
    .update({ caption })
    .eq("id", id)
    .eq("practitioner_id", user.id);
  if (error) {
    console.error("updateGalleryCaption: update failed", error);
    return { error: t("saveFailed") };
  }

  revalidateDashboard();
  return { success: true };
}

// Remove a gallery image: delete the row and best-effort delete the underlying
// storage object (same non-blocking posture as removeProfileImage — an orphaned
// file matters less than a stuck "can't remove" UI).
export async function removeGalleryImage(id: string): Promise<ProfileFormState> {
  const t = await getTranslations("Profile");
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { error: t("notLoggedIn") };
  }

  // Fetch the storage path (scoped to the owner) before deleting the row.
  const { data: row } = await supabase
    .from("practitioner_gallery")
    .select("storage_path")
    .eq("id", id)
    .eq("practitioner_id", user.id)
    .maybeSingle();

  const { error } = await supabase
    .from("practitioner_gallery")
    .delete()
    .eq("id", id)
    .eq("practitioner_id", user.id);
  if (error) {
    console.error("removeGalleryImage: delete failed", error);
    return { error: t("saveFailed") };
  }

  if (row?.storage_path) {
    await supabase.storage
      .from("avatars")
      .remove([row.storage_path])
      .catch((err) => console.error("removeGalleryImage: storage delete failed", err));
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
