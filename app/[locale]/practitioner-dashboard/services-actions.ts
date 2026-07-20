"use server";

import { revalidatePath } from "next/cache";
import { getTranslations } from "next-intl/server";
import { createClient } from "@/lib/supabase/server";

export type ServiceFormState = { error?: string; success?: boolean } | null;

const MAX_NAME_LENGTH = 100;
const MAX_DESCRIPTION_LENGTH = 1000;
const MAX_DURATION_MINUTES = 240; // 4 hours
const MAX_DELIVERY_INFO_LENGTH = 500;
const DELIVERY_TYPES = ["online", "in_person"] as const;
type DeliveryType = (typeof DELIVERY_TYPES)[number];

// JavaScript represents decimals as IEEE754 floats, so e.g. 75.10 * 100
// can come out as 7509.999999999999 rather than exactly 7510 — rounding
// after multiplying corrects for that regardless of which way the error
// goes. Without it, a save could silently be off by one cent.
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
      deliveryInfo: string;
    }
  | { ok: false; error: string };

function isDeliveryType(value: string): value is DeliveryType {
  return (DELIVERY_TYPES as readonly string[]).includes(value);
}

async function parseServiceForm(formData: FormData): Promise<ParsedServiceForm> {
  const t = await getTranslations("Services");
  const name = (formData.get("name") as string)?.trim();
  const description = (formData.get("description") as string)?.trim();
  const durationMinutes = parseInt(formData.get("durationMinutes") as string, 10);
  const rawPrice = formData.get("price") as string;
  const rawDeliveryType = (formData.get("deliveryType") as string)?.trim();
  const deliveryInfo = (formData.get("deliveryInfo") as string)?.trim();

  if (!name) {
    return { ok: false, error: t("nameRequired") };
  }
  if (name.length > MAX_NAME_LENGTH) {
    return { ok: false, error: t("nameTooLong", { max: MAX_NAME_LENGTH }) };
  }
  if (description && description.length > MAX_DESCRIPTION_LENGTH) {
    return { ok: false, error: t("descriptionTooLong", { max: MAX_DESCRIPTION_LENGTH }) };
  }
  if (
    !Number.isInteger(durationMinutes) ||
    durationMinutes <= 0 ||
    durationMinutes % 15 !== 0 ||
    durationMinutes > MAX_DURATION_MINUTES
  ) {
    return { ok: false, error: t("durationInvalid", { max: MAX_DURATION_MINUTES }) };
  }
  const priceCents = eurosToCents(rawPrice);
  if (priceCents === null) {
    return { ok: false, error: t("priceInvalid") };
  }
  // Required, not just nudged — a bookable service with no "how to
  // attend" info is a broken client experience. The DB's own NOT VALID
  // check constraint is the backstop against a direct-API bypass; this
  // is what gives a practitioner a clean, specific message instead.
  if (!rawDeliveryType || !isDeliveryType(rawDeliveryType)) {
    return { ok: false, error: t("deliveryTypeRequired") };
  }
  if (!deliveryInfo) {
    return { ok: false, error: t("deliveryInfoRequired") };
  }
  if (deliveryInfo.length > MAX_DELIVERY_INFO_LENGTH) {
    return { ok: false, error: t("deliveryInfoTooLong", { max: MAX_DELIVERY_INFO_LENGTH }) };
  }

  return {
    ok: true,
    name,
    description: description || null,
    durationMinutes,
    priceCents,
    deliveryType: rawDeliveryType,
    deliveryInfo,
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

  const parsed = await parseServiceForm(formData);
  if (!parsed.ok) {
    return { error: parsed.error };
  }

  const { error } = await supabase.from("services").insert({
    practitioner_id: user.id,
    name: parsed.name,
    description: parsed.description,
    duration_minutes: parsed.durationMinutes,
    price_cents: parsed.priceCents,
    currency: "EUR",
    delivery_type: parsed.deliveryType,
    delivery_info: parsed.deliveryInfo,
  });

  if (error) {
    console.error("createService failed:", error);
    return { error: t("saveFailed") };
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
  const parsed = await parseServiceForm(formData);
  if (!parsed.ok) {
    return { error: parsed.error };
  }

  // RLS already restricts updates to the caller's own rows — the
  // .eq("practitioner_id", ...) here is a belt-and-suspenders match to
  // the same rule, not the actual enforcement mechanism.
  const { error } = await supabase
    .from("services")
    .update({
      name: parsed.name,
      description: parsed.description,
      duration_minutes: parsed.durationMinutes,
      price_cents: parsed.priceCents,
      delivery_type: parsed.deliveryType,
      delivery_info: parsed.deliveryInfo,
    })
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

// Hard delete is fine for now — no bookings table exists yet, so nothing
// could reference a deleted service. Once bookings exist, deleting a
// service that has any booking history must become a soft-delete (set
// is_active = false) instead of a real delete — otherwise existing
// bookings would end up pointing at a service row that no longer exists,
// losing the details that booking's history referred to.
export async function deleteService(serviceId: string, _formData: FormData) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
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
