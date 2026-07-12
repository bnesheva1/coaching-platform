import { getTranslations, getLocale } from "next-intl/server";
import { redirect, Link } from "@/i18n/navigation";
import { createClient } from "@/lib/supabase/server";
import { signOut } from "@/app/actions";
import { ProfileForm } from "./ProfileForm";
import { ServicesSection } from "./ServicesSection";
import { AvailabilitySection } from "./AvailabilitySection";
import { AvailabilityExceptionsSection } from "./AvailabilityExceptionsSection";
import { BookingsList, type PractitionerBooking } from "./BookingsList";
import { splitUpcomingPast } from "@/lib/booking-time";

export default async function PractitionerDashboardPage({
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
    .select("role, display_name")
    .eq("id", user.id)
    .single();

  if (profile?.role !== "practitioner") {
    redirect({ href: "/client-dashboard", locale });
    return null;
  }

  const { data: practitionerProfile } = await supabase
    .from("practitioner_profiles")
    .select("bio, specialties, avatar_url, username, timezone, min_notice_hours")
    .eq("id", user.id)
    .single();

  const { data: services } = await supabase
    .from("services")
    .select("id, name, description, duration_minutes, price_cents, currency, is_active, delivery_type")
    .eq("practitioner_id", user.id)
    .order("created_at", { ascending: true });

  // delivery_info is excluded from the general column grant entirely —
  // even the owning practitioner can't read it via the plain select
  // above. This RPC is the only way it's ever readable, scoped to
  // exactly the caller's own services.
  const { data: deliveryInfoRows } = (await supabase.rpc("get_my_services_delivery_info")) as {
    data: { service_id: string; delivery_info: string | null }[] | null;
  };
  const deliveryInfoByServiceId = new Map(
    (deliveryInfoRows ?? []).map((row) => [row.service_id, row.delivery_info]),
  );
  const servicesWithDeliveryInfo = (services ?? []).map((service) => ({
    ...service,
    delivery_info: deliveryInfoByServiceId.get(service.id) ?? null,
  }));

  const { data: availabilityRules } = await supabase
    .from("practitioner_availability")
    .select("id, day_of_week, start_time, end_time")
    .eq("practitioner_id", user.id);

  const { data: availabilityExceptions } = await supabase
    .from("availability_exceptions")
    .select("id, exception_date, start_time, end_time")
    .eq("practitioner_id", user.id)
    .eq("exception_type", "blocked");

  const { data: bookings } = await supabase
    .from("bookings")
    .select("id, client_id, service_id, start_utc, end_utc, status")
    .eq("practitioner_id", user.id)
    .order("start_utc", { ascending: true });

  const clientIds = [...new Set((bookings ?? []).map((b) => b.client_id))];
  const bookingServiceIds = [...new Set((bookings ?? []).map((b) => b.service_id))];

  const [{ data: clients }, { data: bookingServices }] = await Promise.all([
    clientIds.length > 0
      ? supabase.from("profiles").select("id, display_name").in("id", clientIds)
      : Promise.resolve({ data: [] as { id: string; display_name: string | null }[] }),
    bookingServiceIds.length > 0
      ? supabase.from("services").select("id, name, duration_minutes").in("id", bookingServiceIds)
      : Promise.resolve({ data: [] as { id: string; name: string; duration_minutes: number }[] }),
  ]);

  const clientNameById = new Map((clients ?? []).map((c) => [c.id, c.display_name ?? ""]));
  const bookingServiceById = new Map((bookingServices ?? []).map((s) => [s.id, s]));

  const mergedBookings: PractitionerBooking[] = (bookings ?? []).map((b) => ({
    id: b.id,
    clientName: clientNameById.get(b.client_id) ?? "",
    serviceName: bookingServiceById.get(b.service_id)?.name ?? "",
    durationMinutes: bookingServiceById.get(b.service_id)?.duration_minutes ?? 0,
    startUtc: b.start_utc,
    endUtc: b.end_utc,
    status: b.status as PractitionerBooking["status"],
  }));

  const { upcoming: upcomingBookings, past: pastBookings } = splitUpcomingPast(mergedBookings);

  const justCancelled = resolvedSearchParams.cancelled === "1";
  const cancelErrorCode =
    typeof resolvedSearchParams.cancelError === "string" ? resolvedSearchParams.cancelError : null;

  return (
    <main style={{ maxWidth: 500, margin: "4rem auto", fontFamily: "sans-serif" }}>
      <h1>{t("practitionerTitle")}</h1>
      <form action={signOut} style={{ marginBottom: "1.5rem" }}>
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
      {practitionerProfile?.username && (
        <p>
          <Link href={`/p/${practitionerProfile.username}`}>
            {t("viewPublicProfile")}
          </Link>
        </p>
      )}
      <ProfileForm
        initialUsername={practitionerProfile?.username ?? null}
        initialDisplayName={profile?.display_name ?? ""}
        initialBio={practitionerProfile?.bio ?? ""}
        initialSpecialties={practitionerProfile?.specialties ?? []}
        initialAvatarUrl={practitionerProfile?.avatar_url ?? null}
        initialTimezone={practitionerProfile?.timezone ?? "Europe/Sofia"}
        initialMinNoticeHours={practitionerProfile?.min_notice_hours ?? 24}
      />
      <ServicesSection services={servicesWithDeliveryInfo} />
      <AvailabilitySection
        rules={availabilityRules ?? []}
        timezone={practitionerProfile?.timezone ?? "Europe/Sofia"}
      />
      <AvailabilityExceptionsSection exceptions={availabilityExceptions ?? []} />
      <BookingsList
        upcoming={upcomingBookings}
        past={pastBookings}
        timezone={practitionerProfile?.timezone ?? "Europe/Sofia"}
      />
    </main>
  );
}
