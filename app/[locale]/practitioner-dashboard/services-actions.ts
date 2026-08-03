"use server";

import { revalidatePath } from "next/cache";
import { getTranslations } from "next-intl/server";
import { createClient } from "@/lib/supabase/server";
import { getUpcomingBookingCount } from "@/lib/services/bookingLock";
import { SHOW_PHONE_DELIVERY_OPTION } from "@/lib/serviceDelivery";

export type ServiceFormState = { error?: string; success?: boolean } | null;

const MAX_NAME_LENGTH = 100;
const MAX_DESCRIPTION_LENGTH = 1000;
// Fixed dropdown now (30/45/60/75/90/105/120), not a free numeric
// input — these two bounds are exactly the ends of that list. Mirrors
// supabase/migrations/20260803150000_services_duration_cap_120.sql.
const MIN_DURATION_MINUTES = 30;
const MAX_DURATION_MINUTES = 120;
// €20. Mirrors supabase/migrations/20260803150500_services_price_minimum_20eur.sql.
const MIN_PRICE_CENTS = 2000;
// €500 platform default — a practitioner's own practitioner_profiles.
// max_price_cents overrides this when set (see getEffectiveMaxPriceCents
// below); this constant is only the fallback. Mirrors the trigger in
// supabase/migrations/20260803151500_practitioner_max_price_override.sql,
// which is the actual hard guarantee for a direct-API bypass — this is
// what gives a practitioner a clean, specific message instead.
const DEFAULT_MAX_PRICE_CENTS = 50000;
const MAX_DELIVERY_INFO_LENGTH = 500;
const MAX_PHONE_LENGTH = 30;
type DeliveryType = "online" | "in_person" | "phone";
// "phone" always exists as a schema-level option regardless of the flag
// (see lib/serviceDelivery.ts's own comment) — this is what actually
// gates the server accepting it, not just the UI hiding the radio, so
// hiding the option really does hide it end to end.
const DELIVERY_TYPES: readonly DeliveryType[] = SHOW_PHONE_DELIVERY_OPTION
  ? ["online", "in_person", "phone"]
  : ["online", "in_person"];

// Same bucket, same limits as the profile's avatar/banner upload
// (uploadProfileImage in actions.ts) — services just get their own
// path, "<user id>/service-<service id>", already permitted by that
// bucket's existing policies (scoped to "own folder", not to a
// specific filename).
const MAX_IMAGE_BYTES = 2 * 1024 * 1024; // 2MB, matches the bucket's own limit
const ALLOWED_IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp"];

async function uploadServiceImage(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  serviceId: string,
  imageFile: File,
): Promise<{ url?: string; error?: string }> {
  const t = await getTranslations("Services");
  if (!ALLOWED_IMAGE_TYPES.includes(imageFile.type)) {
    return { error: t("imageInvalidType") };
  }
  if (imageFile.size > MAX_IMAGE_BYTES) {
    return { error: t("imageTooLarge") };
  }

  const path = `${userId}/service-${serviceId}`;
  const { error: uploadError } = await supabase.storage.from("avatars").upload(path, imageFile, {
    upsert: true,
    contentType: imageFile.type,
  });
  if (uploadError) {
    return { error: t("imageUploadFailed", { message: uploadError.message }) };
  }

  const {
    data: { publicUrl },
  } = supabase.storage.from("avatars").getPublicUrl(path);
  // Cache-bust: the path never changes, so without this the browser
  // (or a CDN) may keep showing the old image after it's replaced.
  return { url: `${publicUrl}?t=${Date.now()}` };
}

// JavaScript represents decimals as IEEE754 floats, so e.g. 75.10 * 100
// can come out as 7509.999999999999 rather than exactly 7510 — rounding
// after multiplying corrects for that regardless of which way the error
// goes. Without it, a save could silently be off by one cent.
// Returns null for "not a valid number at all" (distinct from "valid
// but below the minimum," which parseServiceForm checks separately —
// the two cases get different, more helpful messages).
function eurosToCents(rawEuros: string): number | null {
  const euros = parseFloat(rawEuros);
  if (Number.isNaN(euros) || euros < 0) {
    return null;
  }
  return Math.round(euros * 100);
}

type ParsedServiceForm =
  | {
      ok: true;
      name: string;
      description: string | null;
      durationMinutes: number;
      priceCents: number;
      deliveryType: DeliveryType;
      deliveryInfo: string | null;
      phoneNumber: string | null;
    }
  | { ok: false; error: string };

function isDeliveryType(value: string): value is DeliveryType {
  return (DELIVERY_TYPES as readonly string[]).includes(value);
}

// get_my_max_price_cents() is SECURITY DEFINER, scoped to auth.uid() —
// there's no column grant for max_price_cents itself (see the migration's
// own comment: it's an admin-set field, not something to expose via a
// plain select even to its own owner), so this RPC is the only way a
// practitioner's own server action can read it.
async function getEffectiveMaxPriceCents(supabase: Awaited<ReturnType<typeof createClient>>): Promise<number> {
  const { data } = await supabase.rpc("get_my_max_price_cents");
  return (data as number | null) ?? DEFAULT_MAX_PRICE_CENTS;
}

async function parseServiceForm(formData: FormData, maxPriceCents: number): Promise<ParsedServiceForm> {
  const t = await getTranslations("Services");
  const name = (formData.get("name") as string)?.trim();
  const description = (formData.get("description") as string)?.trim();
  const durationMinutes = parseInt(formData.get("durationMinutes") as string, 10);
  const rawPrice = formData.get("price") as string;
  const rawDeliveryType = (formData.get("deliveryType") as string)?.trim();
  const deliveryInfo = (formData.get("deliveryInfo") as string)?.trim();
  const phoneNumber = (formData.get("phoneNumber") as string)?.trim();

  if (!name) {
    return { ok: false, error: t("nameRequired") };
  }
  if (name.length > MAX_NAME_LENGTH) {
    return { ok: false, error: t("nameTooLong", { max: MAX_NAME_LENGTH }) };
  }
  if (description && description.length > MAX_DESCRIPTION_LENGTH) {
    return { ok: false, error: t("descriptionTooLong", { max: MAX_DESCRIPTION_LENGTH }) };
  }
  // The client now only ever submits one of the 7 dropdown values
  // (30/45/60/75/90/105/120), but this re-validates from scratch
  // regardless — a direct API call isn't bound by what the <select>
  // offers. Multiple-of-15 between the two bounds happens to be exactly
  // that 7-value set, so no separate array-membership check is needed.
  if (
    !Number.isInteger(durationMinutes) ||
    durationMinutes % 15 !== 0 ||
    durationMinutes < MIN_DURATION_MINUTES ||
    durationMinutes > MAX_DURATION_MINUTES
  ) {
    return { ok: false, error: t("durationInvalid", { min: MIN_DURATION_MINUTES, max: MAX_DURATION_MINUTES }) };
  }
  const priceCents = eurosToCents(rawPrice);
  if (priceCents === null) {
    return { ok: false, error: t("priceInvalid") };
  }
  if (priceCents < MIN_PRICE_CENTS) {
    return { ok: false, error: t("priceTooLow", { min: (MIN_PRICE_CENTS / 100).toFixed(0) }) };
  }
  if (priceCents > maxPriceCents) {
    return { ok: false, error: t("priceTooHigh", { max: (maxPriceCents / 100).toFixed(0) }) };
  }
  // Required, not just nudged — a bookable service with no "how to
  // attend" info is a broken client experience. The DB's own NOT VALID
  // check constraint is the backstop against a direct-API bypass; this
  // is what gives a practitioner a clean, specific message instead.
  if (!rawDeliveryType || !isDeliveryType(rawDeliveryType)) {
    return { ok: false, error: t("deliveryTypeRequired") };
  }

  // phone_number REPLACES delivery_info for this type — the existing
  // free-text field is meant for an address (in_person), which doesn't
  // apply to "call this number."
  if (rawDeliveryType === "phone") {
    if (!phoneNumber) {
      return { ok: false, error: t("phoneNumberRequired") };
    }
    if (phoneNumber.length > MAX_PHONE_LENGTH) {
      return { ok: false, error: t("phoneNumberTooLong", { max: MAX_PHONE_LENGTH }) };
    }
  } else if (rawDeliveryType === "in_person") {
    if (!deliveryInfo) {
      return { ok: false, error: t("deliveryInfoRequired") };
    }
    if (deliveryInfo.length > MAX_DELIVERY_INFO_LENGTH) {
      return { ok: false, error: t("deliveryInfoTooLong", { max: MAX_DELIVERY_INFO_LENGTH }) };
    }
  }
  // online: no delivery_info collected at all anymore — a per-booking
  // link will be auto-generated (LiveKit) rather than practitioner-
  // entered. The field simply isn't rendered for this type; see
  // updateService below for how an existing online service's stored
  // delivery_info (if any, from before this change) is preserved
  // rather than silently wiped by an unrelated edit.

  return {
    ok: true,
    name,
    description: description || null,
    durationMinutes,
    priceCents,
    deliveryType: rawDeliveryType,
    deliveryInfo: rawDeliveryType === "in_person" ? deliveryInfo : null,
    phoneNumber: rawDeliveryType === "phone" ? phoneNumber : null,
  };
}

export async function createService(
  _prevState: ServiceFormState,
  formData: FormData,
): Promise<ServiceFormState> {
  const t = await getTranslations("Services");
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { error: t("notLoggedIn") };
  }

  const maxPriceCents = await getEffectiveMaxPriceCents(supabase);
  const parsed = await parseServiceForm(formData, maxPriceCents);
  if (!parsed.ok) {
    return { error: parsed.error };
  }

  // .select("id") only — delivery_info is excluded from the column
  // grant, and a bare .select() implicitly requests every
  // granted-visible column via RETURNING (same reasoning already noted
  // elsewhere for this table).
  const { data: inserted, error } = await supabase
    .from("services")
    .insert({
      practitioner_id: user.id,
      name: parsed.name,
      description: parsed.description,
      duration_minutes: parsed.durationMinutes,
      price_cents: parsed.priceCents,
      currency: "EUR",
      delivery_type: parsed.deliveryType,
      delivery_info: parsed.deliveryInfo,
      phone_number: parsed.phoneNumber,
    })
    .select("id")
    .single();

  if (error) {
    console.error("createService failed:", error);
    return { error: t("saveFailed") };
  }

  // Image upload happens after the insert (the storage path needs the
  // new row's id) — a failure here doesn't roll back the service
  // itself, which is the right tradeoff: a service without a photo yet
  // is still a real, usable service; losing the whole submission over a
  // failed image upload would be worse.
  const imageEntry = formData.get("image");
  const imageFile = imageEntry instanceof File && imageEntry.size > 0 ? imageEntry : null;
  if (imageFile) {
    const { url, error: imageError } = await uploadServiceImage(supabase, user.id, inserted.id, imageFile);
    if (imageError) {
      return { error: imageError };
    }
    await supabase.from("services").update({ image_url: url }).eq("id", inserted.id);
  }

  // "layout" — see availability-actions.ts's identical comment; the
  // dashboard is now a layout + six pages, not one page.
  revalidatePath("/practitioner-dashboard", "layout");
  return { success: true };
}

export async function updateService(
  _prevState: ServiceFormState,
  formData: FormData,
): Promise<ServiceFormState> {
  const t = await getTranslations("Services");
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { error: t("notLoggedIn") };
  }

  const serviceId = formData.get("serviceId") as string;
  const maxPriceCents = await getEffectiveMaxPriceCents(supabase);
  const parsed = await parseServiceForm(formData, maxPriceCents);
  if (!parsed.ok) {
    return { error: parsed.error };
  }

  // Lock re-verification — the actual enforcement. The UI disables
  // these 3 inputs once a service has active/upcoming bookings, but a
  // disabled attribute is a courtesy, not a boundary: this independently
  // re-checks against the CURRENT stored values regardless of what the
  // client submitted, so a hand-crafted request bypassing the disabled
  // inputs still can't change a locked field.
  const { data: currentService } = await supabase
    .from("services")
    .select("price_cents, duration_minutes, delivery_type, image_url")
    .eq("id", serviceId)
    .eq("practitioner_id", user.id)
    .single();

  if (!currentService) {
    return { error: t("saveFailed") };
  }

  const upcomingBookingCount = await getUpcomingBookingCount(supabase, serviceId);
  if (upcomingBookingCount > 0) {
    const structuralFieldsChanged =
      parsed.priceCents !== currentService.price_cents ||
      parsed.durationMinutes !== currentService.duration_minutes ||
      parsed.deliveryType !== currentService.delivery_type;
    if (structuralFieldsChanged) {
      return { error: t("fieldsLockedError", { count: upcomingBookingCount }) };
    }
  }

  const updatePayload: {
    name: string;
    description: string | null;
    duration_minutes: number;
    price_cents: number;
    delivery_type: DeliveryType;
    delivery_info?: string | null;
    phone_number: string | null;
    image_url?: string | null;
  } = {
    name: parsed.name,
    description: parsed.description,
    duration_minutes: parsed.durationMinutes,
    price_cents: parsed.priceCents,
    delivery_type: parsed.deliveryType,
    phone_number: parsed.phoneNumber,
  };

  // delivery_info isn't collected in the form at all for online (see
  // parseServiceForm) — parsed.deliveryInfo is unconditionally null in
  // that case, but blindly writing that null would wipe out a value an
  // online service already had from before this field was hidden, on
  // every unrelated edit (renaming it, say). Only touch the column when
  // there's a real value to write (in_person) or when the type is
  // actually CHANGING into online, where a leftover address/meeting
  // link from the previous type would otherwise be stale and
  // misleading. Staying online → column is simply omitted from the
  // payload, left exactly as it was.
  if (parsed.deliveryType !== "online" || currentService.delivery_type !== "online") {
    updatePayload.delivery_info = parsed.deliveryInfo;
  }

  const imageEntry = formData.get("image");
  const imageFile = imageEntry instanceof File && imageEntry.size > 0 ? imageEntry : null;
  const removeImage = formData.get("removeImage") === "1";
  if (imageFile) {
    const { url, error: imageError } = await uploadServiceImage(supabase, user.id, serviceId, imageFile);
    if (imageError) {
      return { error: imageError };
    }
    updatePayload.image_url = url;
  } else if (removeImage && currentService.image_url) {
    // Best-effort storage cleanup — same path convention
    // uploadServiceImage writes to. A failed delete here doesn't block
    // clearing image_url below; an orphaned storage object is a much
    // smaller problem than a stuck "can't remove my photo" form.
    const { error: deleteError } = await supabase.storage.from("avatars").remove([`${user.id}/service-${serviceId}`]);
    if (deleteError) {
      console.error("updateService: failed to delete storage object on image removal", { serviceId, deleteError });
    }
    updatePayload.image_url = null;
  }

  // RLS already restricts updates to the caller's own rows — the
  // .eq("practitioner_id", ...) here is a belt-and-suspenders match to
  // the same rule, not the actual enforcement mechanism.
  const { error } = await supabase
    .from("services")
    .update(updatePayload)
    .eq("id", serviceId)
    .eq("practitioner_id", user.id);

  if (error) {
    console.error("updateService failed:", error);
    return { error: t("saveFailed") };
  }

  // "layout" — see availability-actions.ts's identical comment; the
  // dashboard is now a layout + six pages, not one page.
  revalidatePath("/practitioner-dashboard", "layout");
  return { success: true };
}

export async function setServiceActive(
  serviceId: string,
  isActive: boolean,
  _formData: FormData,
) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return;
  }

  const { error } = await supabase
    .from("services")
    .update({ is_active: isActive })
    .eq("id", serviceId)
    .eq("practitioner_id", user.id);

  if (error) {
    console.error("setServiceActive failed:", error);
  }

  // "layout" — see availability-actions.ts's identical comment; the
  // dashboard is now a layout + six pages, not one page.
  revalidatePath("/practitioner-dashboard", "layout");
}

// bookings.service_id is `on delete cascade` (see the create_bookings
// migration) — a hard delete of a service with any upcoming booking
// would silently take those bookings with it, including ones a client
// has already paid for. The UI routes this case to a "can't delete,
// hide instead" dialog rather than the real delete action, but that's
// a courtesy, not the boundary (same reasoning as updateService's lock
// re-check below) — this independently re-verifies before deleting, so
// a hand-crafted request bypassing the UI still can't destroy live
// booking history.
export async function deleteService(serviceId: string, _formData: FormData) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return;
  }

  const upcomingBookingCount = await getUpcomingBookingCount(supabase, serviceId);
  if (upcomingBookingCount > 0) {
    console.error("deleteService rejected: service has upcoming bookings", { serviceId, upcomingBookingCount });
    return;
  }

  const { error } = await supabase
    .from("services")
    .delete()
    .eq("id", serviceId)
    .eq("practitioner_id", user.id);

  if (error) {
    console.error("deleteService failed:", error);
  }

  // "layout" — see availability-actions.ts's identical comment; the
  // dashboard is now a layout + six pages, not one page.
  revalidatePath("/practitioner-dashboard", "layout");
}
