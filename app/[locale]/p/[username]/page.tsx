import { notFound } from "next/navigation";
import { getTranslations, getLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { createClient } from "@/lib/supabase/server";
import { getBookableSlots } from "@/lib/availability/slots";
import { SlotList } from "./SlotList";
import specialties from "@/data/specialties.json";

const INTL_LOCALES: Record<string, string> = {
  bg: "bg-BG",
  en: "en-US",
};

export default async function PublicProfilePage({
  params,
  searchParams,
}: {
  params: Promise<{ username: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const { username } = await params;
  const normalizedUsername = username.toLowerCase();
  const resolvedSearchParams = await searchParams;
  const selectedServiceId =
    typeof resolvedSearchParams.service === "string" ? resolvedSearchParams.service : null;

  const t = await getTranslations("PublicProfile");
  const tBooking = await getTranslations("Booking");
  const locale = await getLocale();
  const intlLocale = INTL_LOCALES[locale] ?? "en-US";
  const specialtyLabels = new Map(
    specialties.map((s) => [s.key, s[locale as "en" | "bg"] ?? s.en]),
  );

  const supabase = await createClient();

  const { data: practitionerProfile } = await supabase
    .from("practitioner_profiles")
    .select("id, bio, specialties, avatar_url, username, timezone")
    .eq("username", normalizedUsername)
    .single();

  // No matching username — including a practitioner who hasn't set one
  // yet — means there is simply no live page here.
  if (!practitionerProfile) {
    notFound();
  }

  const [{ data: profile }, { data: services }, { data: authData }] = await Promise.all([
    supabase
      .from("profiles")
      .select("display_name")
      .eq("id", practitionerProfile.id)
      .single(),
    supabase
      .from("services")
      .select("id, name, description, duration_minutes, price_cents, currency")
      .eq("practitioner_id", practitionerProfile.id)
      .eq("is_active", true)
      .order("created_at", { ascending: true }),
    supabase.auth.getUser(),
  ]);

  const isOwner = authData.user?.id === practitionerProfile.id;

  // Only fetch slots for a service that's actually in this practitioner's
  // own active service list — getBookableSlots also re-checks this
  // server-side (never trusts the id alone), this just avoids a wasted
  // call for an obviously-invalid selection.
  const selectedService = selectedServiceId
    ? (services ?? []).find((s) => s.id === selectedServiceId)
    : null;
  const slots = selectedService
    ? await getBookableSlots({
        practitionerId: practitionerProfile.id,
        serviceId: selectedService.id,
      })
    : null;

  return (
    <main style={{ maxWidth: 500, margin: "4rem auto", fontFamily: "sans-serif" }}>
      {isOwner && (
        <p>
          <Link href="/practitioner-dashboard">{t("editProfile")}</Link>
        </p>
      )}

      {practitionerProfile.avatar_url && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={practitionerProfile.avatar_url}
          alt={profile?.display_name || practitionerProfile.username || t("profilePhotoAlt")}
          style={{
            width: 120,
            height: 120,
            objectFit: "cover",
            borderRadius: "50%",
            display: "block",
            marginBottom: "1rem",
          }}
        />
      )}

      <h1>{profile?.display_name || `@${practitionerProfile.username}`}</h1>
      <p style={{ color: "#666" }}>@{practitionerProfile.username}</p>

      {practitionerProfile.specialties?.length > 0 && (
        <p>
          {practitionerProfile.specialties
            .map((key: string) => specialtyLabels.get(key) ?? key)
            .join(" · ")}
        </p>
      )}

      {practitionerProfile.bio && <p>{practitionerProfile.bio}</p>}

      {services && services.length > 0 && (
        <section>
          <h2>{t("servicesTitle")}</h2>
          {!selectedServiceId && (
            <p style={{ fontSize: "0.85rem", color: "#666" }}>{tBooking("selectService")}</p>
          )}
          <ul style={{ listStyle: "none", padding: 0 }}>
            {services.map((service) => {
              const isSelected = service.id === selectedServiceId;
              return (
                <li key={service.id} style={{ marginBottom: "1rem" }}>
                  <Link href={isSelected ? "?" : `?service=${service.id}`}>
                    <strong>{service.name}</strong>
                  </Link>{" "}
                  —{" "}
                  {t("serviceDuration", { minutes: service.duration_minutes })} —{" "}
                  {new Intl.NumberFormat(intlLocale, {
                    style: "currency",
                    currency: service.currency,
                  }).format(service.price_cents / 100)}
                  {service.description && (
                    <p style={{ margin: "0.25rem 0 0" }}>{service.description}</p>
                  )}
                  {isSelected && (
                    <div style={{ marginTop: "0.5rem" }}>
                      <h3>{tBooking("availableTimes")}</h3>
                      <SlotList slots={slots ?? []} />
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </main>
  );
}
