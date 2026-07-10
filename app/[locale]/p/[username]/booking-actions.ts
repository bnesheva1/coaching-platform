"use server";

import { getLocale } from "next-intl/server";
import { redirect } from "@/i18n/navigation";
import { createClient } from "@/lib/supabase/server";
import { checkRateLimit, bookingLimiter } from "@/lib/rate-limit";
import { getBookableSlots } from "@/lib/availability/slots";

// Bound via .bind() from the button, not editable form fields — but
// binding isn't a security boundary, a direct API call can still send
// any arguments it wants. Every value here is re-derived/re-validated
// from scratch below before anything is written; nothing is trusted
// just because it arrived via a bound action.
export async function bookSlot(
  practitionerId: string,
  serviceId: string,
  username: string,
  startUtc: string,
  _formData: FormData,
) {
  const locale = await getLocale();

  async function redirectWithError(code: string) {
    redirect({
      href: { pathname: `/p/${username}`, query: { service: serviceId, bookingError: code } },
      locale,
    });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect({ href: "/login", locale });
    return;
  }

  // Keyed by user id, not IP — booking already requires auth, so this is
  // a more precise identifier than IP for bounding one account
  // spam-booking a practitioner's calendar.
  const { success } = await checkRateLimit(bookingLimiter, user.id);
  if (!success) {
    await redirectWithError("rateLimited");
    return;
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  if (profile?.role !== "client") {
    await redirectWithError("onlyClientsCanBook");
    return;
  }

  // Real duration always comes from this row, scoped to the practitioner
  // and active-only — never trusted from any client-supplied value.
  const { data: service } = await supabase
    .from("services")
    .select("duration_minutes")
    .eq("id", serviceId)
    .eq("practitioner_id", practitionerId)
    .eq("is_active", true)
    .single();

  if (!service) {
    await redirectWithError("slotNoLongerAvailable");
    return;
  }

  // The actual re-validation: re-run the exact same slot-generation slice
  // 1 already built, and confirm the requested instant is genuinely
  // still offered. A forged, off-grid, past, or already-booked startUtc
  // simply won't appear here.
  const freshSlots = await getBookableSlots({ practitionerId, serviceId });
  const isValidSlot = freshSlots.some((slot) => slot.startUtc === startUtc);
  if (!isValidSlot) {
    await redirectWithError("slotNoLongerAvailable");
    return;
  }

  const endUtc = new Date(
    new Date(startUtc).getTime() + service.duration_minutes * 60 * 1000,
  ).toISOString();

  const { error } = await supabase.from("bookings").insert({
    practitioner_id: practitionerId,
    client_id: user.id,
    service_id: serviceId,
    start_utc: startUtc,
    end_utc: endUtc,
  });

  if (error) {
    // 23P01 = exclusion_violation — the race case: this slot passed
    // re-validation above but a concurrent request won it in the tiny
    // window between that check and this insert. This is exactly what
    // the DB-level exclusion constraint exists to catch; the app-level
    // check above closes the much larger "forged/stale slot" case, this
    // closes the true concurrency race.
    if (error.code === "23P01") {
      await redirectWithError("slotTaken");
      return;
    }
    console.error("bookSlot failed:", error);
    await redirectWithError("bookingFailed");
    return;
  }

  redirect({
    href: { pathname: `/p/${username}`, query: { service: serviceId, booked: "1" } },
    locale,
  });
}
