"use server";

import { revalidatePath } from "next/cache";
import { getLocale } from "next-intl/server";
import { redirect } from "@/i18n/navigation";
import { createClient } from "@/lib/supabase/server";
import { sendCancellationNoticeEmail } from "@/lib/email";

// No notice-cutoff check here, deliberately — a practitioner can cancel
// any of their own bookings at any time, including within the client's
// notice window (emergencies happen). Enforced by the practitioner-
// cancel RLS UPDATE policy having no such clause at all, not by a
// bypass of one.
export async function cancelBookingAsPractitioner(bookingId: string, _formData: FormData) {
  const locale = await getLocale();

  async function redirectWithError(code: string) {
    redirect({ href: { pathname: "/practitioner-dashboard/bookings", query: { cancelError: code } }, locale });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect({ href: "/login", locale });
    return;
  }

  const { data: updated, error } = await supabase
    .from("bookings")
    .update({ status: "cancelled_by_practitioner" })
    .eq("id", bookingId)
    .eq("practitioner_id", user.id)
    .select();

  if (error || !updated || updated.length === 0) {
    if (error) console.error("cancelBookingAsPractitioner failed:", error);
    await redirectWithError("cancellationFailed");
    return;
  }

  // Notifies the client (the counterparty) — never fails or blocks the
  // cancellation that already succeeded above.
  await sendCancellationNoticeEmail(bookingId, "practitioner");

  // "layout" — the shared layout's sidebar pulse card (this week's
  // session count) reads bookings too; without this it would keep
  // showing the pre-cancellation count until a hard refresh, since a
  // redirect() navigation reuses the already-rendered layout segment
  // rather than re-fetching it.
  revalidatePath("/practitioner-dashboard", "layout");

  redirect({ href: { pathname: "/practitioner-dashboard/bookings", query: { cancelled: "1" } }, locale });
}
