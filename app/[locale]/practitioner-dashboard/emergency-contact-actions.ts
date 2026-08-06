"use server";

import { revalidatePath } from "next/cache";
import { getTranslations } from "next-intl/server";
import { createClient } from "@/lib/supabase/server";

export type EmergencyContactState = { error?: string; success?: boolean } | null;

const MAX_LENGTH = 100;

// The practitioner sets their OWN emergency contact. Leaving it blank is a
// legitimate choice (clears it), never an error. emergency_contact is now
// in the practitioner_profiles update grant (own-row via the update RLS
// policy), so a plain update works.
export async function updateEmergencyContact(
  _prevState: EmergencyContactState,
  formData: FormData,
): Promise<EmergencyContactState> {
  const t = await getTranslations("AccountSettings");
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { error: t("emergencyContactNotLoggedIn") };
  }

  const raw = ((formData.get("emergencyContact") as string | null) ?? "").trim();
  if (raw.length > MAX_LENGTH) {
    return { error: t("emergencyContactTooLong", { max: MAX_LENGTH }) };
  }
  // Blank clears it — an intentional "no fallback" choice.
  const value = raw === "" ? null : raw;

  const { error } = await supabase.from("practitioner_profiles").update({ emergency_contact: value }).eq("id", user.id);
  if (error) {
    console.error("updateEmergencyContact failed:", error);
    return { error: t("emergencyContactSaveFailed") };
  }

  revalidatePath("/practitioner-dashboard", "layout");
  return { success: true };
}

// Per-booking, in-advance revocation. The RPC enforces practitioner
// ownership, online-only, and the now() < opens_at (advance-only) window;
// it returns false if the change wasn't allowed (e.g. the window already
// opened), which the caller surfaces.
export async function setBookingEmergencyContactRevoked(
  bookingId: string,
  revoked: boolean,
): Promise<{ ok: boolean }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false };

  const { data, error } = await supabase.rpc("set_booking_emergency_contact_revoked", {
    target_booking_id: bookingId,
    p_revoked: revoked,
  });
  if (error) {
    console.error("setBookingEmergencyContactRevoked failed:", error);
    return { ok: false };
  }
  revalidatePath("/practitioner-dashboard", "layout");
  return { ok: data === true };
}
