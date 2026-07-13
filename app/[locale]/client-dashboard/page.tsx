import { getTranslations, getLocale } from "next-intl/server";
import { redirect } from "@/i18n/navigation";
import { createClient } from "@/lib/supabase/server";
import { signOut } from "@/app/actions";
import { BookingsList, type ClientBooking } from "./BookingsList";
import { splitUpcomingPast } from "@/lib/booking-time";

export default async function ClientDashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const t = await getTranslations("Dashboard");
  const tBooking = await getTranslations("Booking");
  const locale = await getLocale();
  const resolvedSearchParams = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect({ href: "/login", locale });
    return null;
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  if (profile?.role !== "client") {
    redirect({ href: "/practitioner-dashboard", locale });
    return null;
  }

  const { data: bookings } = await supabase
    .from("bookings")
    .select("id, practitioner_id, service_id, start_utc, end_utc, status")
    .eq("client_id", user.id)
    .order("start_utc", { ascending: true });

  const practitionerIds = [...new Set((bookings ?? []).map((b) => b.practitioner_id))];
  const serviceIds = [...new Set((bookings ?? []).map((b) => b.service_id))];

  const [{ data: practitioners }, { data: practitionerNoticeSettings }, { data: services }] =
    await Promise.all([
      practitionerIds.length > 0
        ? supabase.from("profiles").select("id, display_name").in("id", practitionerIds)
        : Promise.resolve({ data: [] as { id: string; display_name: string | null }[] }),
      practitionerIds.length > 0
        ? supabase.from("practitioner_profiles").select("id, min_notice_hours").in("id", practitionerIds)
        : Promise.resolve({ data: [] as { id: string; min_notice_hours: number }[] }),
      serviceIds.length > 0
        ? supabase.from("services").select("id, name, duration_minutes, delivery_type").in("id", serviceIds)
        : Promise.resolve({
            data: [] as { id: string; name: string; duration_minutes: number; delivery_type: string | null }[],
          }),
    ]);

  // delivery_info is excluded from the general column grant — this RPC
  // is the only way to read it, scoped to services this client has an
  // ACTIVE (pending/confirmed) booking for. A cancelled booking's
  // service simply won't appear here.
  const { data: deliveryInfoRows } = (await supabase.rpc("get_my_active_booking_delivery_info")) as {
    data: { service_id: string; delivery_info: string | null }[] | null;
  };
  const deliveryInfoByServiceId = new Map(
    (deliveryInfoRows ?? []).map((row) => [row.service_id, row.delivery_info]),
  );

  // booking_id is excluded from reviews' column grant, so this batched
  // RPC (one call for every booking, not one per row) is the only way
  // to know which of this client's own bookings already have a review.
  const { data: reviewedBookingRows } = (await supabase.rpc("get_my_reviewed_booking_ids")) as {
    data: { booking_id: string }[] | null;
  };
  const reviewedBookingIds = new Set((reviewedBookingRows ?? []).map((row) => row.booking_id));

  const practitionerNameById = new Map((practitioners ?? []).map((p) => [p.id, p.display_name ?? ""]));
  const minNoticeHoursById = new Map(
    (practitionerNoticeSettings ?? []).map((p) => [p.id, p.min_notice_hours]),
  );
  const serviceById = new Map((services ?? []).map((s) => [s.id, s]));

  const mergedBookings: ClientBooking[] = (bookings ?? []).map((b) => ({
    id: b.id,
    practitionerName: practitionerNameById.get(b.practitioner_id) ?? "",
    serviceName: serviceById.get(b.service_id)?.name ?? "",
    durationMinutes: serviceById.get(b.service_id)?.duration_minutes ?? 0,
    startUtc: b.start_utc,
    endUtc: b.end_utc,
    status: b.status as ClientBooking["status"],
    minNoticeHours: minNoticeHoursById.get(b.practitioner_id) ?? 24,
    deliveryType: serviceById.get(b.service_id)?.delivery_type as ClientBooking["deliveryType"],
    deliveryInfo: deliveryInfoByServiceId.get(b.service_id) ?? null,
    hasReview: reviewedBookingIds.has(b.id),
  }));

  const { upcoming, past } = splitUpcomingPast(mergedBookings);

  const justCancelled = resolvedSearchParams.cancelled === "1";
  const cancelErrorCode =
    typeof resolvedSearchParams.cancelError === "string" ? resolvedSearchParams.cancelError : null;

  return (
    <main style={{ maxWidth: 400, margin: "4rem auto", fontFamily: "sans-serif" }}>
      <h1>{t("clientTitle")}</h1>
      <form action={signOut}>
        <button type="submit">{t("signOut")}</button>
      </form>
      {justCancelled && <p style={{ color: "green" }}>{tBooking("cancelledMessage")}</p>}
      {cancelErrorCode && (
        <p style={{ color: "crimson" }}>
          {tBooking.has(cancelErrorCode)
            ? tBooking(cancelErrorCode as Parameters<typeof tBooking>[0])
            : tBooking("cancellationFailed")}
        </p>
      )}
      <BookingsList upcoming={upcoming} past={past} />
    </main>
  );
}
