"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export type ServiceFormState = { error?: string; success?: boolean } | null;

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
    }
  | { ok: false; error: string };

function parseServiceForm(formData: FormData): ParsedServiceForm {
  const name = (formData.get("name") as string)?.trim();
  const description = (formData.get("description") as string)?.trim();
  const durationMinutes = parseInt(formData.get("durationMinutes") as string, 10);
  const rawPrice = formData.get("price") as string;

  if (!name) {
    return { ok: false, error: "Name is required." };
  }
  if (!Number.isInteger(durationMinutes) || durationMinutes <= 0) {
    return { ok: false, error: "Duration must be a positive number of minutes." };
  }
  const priceCents = eurosToCents(rawPrice);
  if (priceCents === null) {
    return { ok: false, error: "Enter a valid price." };
  }

  return { ok: true, name, description: description || null, durationMinutes, priceCents };
}

export async function createService(
  _prevState: ServiceFormState,
  formData: FormData,
): Promise<ServiceFormState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { error: "Not logged in." };
  }

  const parsed = parseServiceForm(formData);
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
  });

  if (error) {
    return { error: error.message };
  }

  revalidatePath("/practitioner-dashboard");
  return { success: true };
}

export async function updateService(
  _prevState: ServiceFormState,
  formData: FormData,
): Promise<ServiceFormState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { error: "Not logged in." };
  }

  const serviceId = formData.get("serviceId") as string;
  const parsed = parseServiceForm(formData);
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
    })
    .eq("id", serviceId)
    .eq("practitioner_id", user.id);

  if (error) {
    return { error: error.message };
  }

  revalidatePath("/practitioner-dashboard");
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

  await supabase
    .from("services")
    .update({ is_active: isActive })
    .eq("id", serviceId)
    .eq("practitioner_id", user.id);

  revalidatePath("/practitioner-dashboard");
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

  await supabase
    .from("services")
    .delete()
    .eq("id", serviceId)
    .eq("practitioner_id", user.id);

  revalidatePath("/practitioner-dashboard");
}
