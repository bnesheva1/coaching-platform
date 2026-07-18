import { notFound } from "next/navigation";
import { getTranslations, getLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { createClient } from "@/lib/supabase/server";
import { getBookableSlots } from "@/lib/availability/slots";
import { ContentContainer } from "@/components/ui/ContentContainer";
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
  const tReviews = await getTranslations("Reviews");
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

  const [{ data: profile }, { data: services }, { data: authData }, { data: reviews }] = await Promise.all([
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
    // Public grant (rating, review_text, created_at) — booking_id is
    // excluded from it entirely, and there's no name column at all: every
    // review is shown as "Verified user", to the public and the
    // practitioner alike, never any identifying detail.
    supabase
      .from("reviews")
      .select("id, rating, review_text, created_at")
      .eq("practitioner_id", practitionerProfile.id)
      .order("created_at", { ascending: false }),
  ]);

  const averageRating =
    reviews && reviews.length > 0
      ? reviews.reduce((sum, r) => sum + r.rating, 0) / reviews.length
      : null;

  const isOwner = authData.user?.id === practitionerProfile.id;

  // The VIEWER's own role (not the practitioner-being-viewed's) —
  // determines whether SlotList shows real book buttons, an
  // "only clients can book" note, or a log-in prompt. Can't be part of
  // the Promise.all above since it depends on that call's own result.
  const { data: viewerProfile } = authData.user
    ? await supabase.from("profiles").select("role").eq("id", authData.user.id).single()
    : { data: null };
  const viewerRole: "client" | "practitioner" | null =
    viewerProfile?.role === "client" || viewerProfile?.role === "practitioner"
      ? viewerProfile.role
      : null;

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

  const justBooked = resolvedSearchParams.booked === "1";
  const bookingErrorCode =
    typeof resolvedSearchParams.bookingError === "string" ? resolvedSearchParams.bookingError : null;

  return (
    <main style={{ padding: "var(--space-16) 0" }}>
      <ContentContainer maxWidth={500}>
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
              marginBottom: "var(--space-4)",
            }}
          />
        )}

        <h1 style={{ font: "var(--text-heading-lg)" }}>{profile?.display_name || `@${practitionerProfile.username}`}</h1>
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
            <h2 style={{ font: "var(--text-heading-md)" }}>{t("servicesTitle")}</h2>
            {!selectedServiceId && (
              <p style={{ font: "var(--text-body-sm)", color: "#666" }}>{tBooking("selectService")}</p>
            )}
            {justBooked && <p style={{ color: "green" }}>{tBooking("bookingConfirmed")}</p>}
            {bookingErrorCode && (
              <p style={{ color: "crimson" }}>
                {tBooking.has(bookingErrorCode)
                  ? tBooking(bookingErrorCode as Parameters<typeof tBooking>[0])
                  : tBooking("bookingFailed")}
              </p>
            )}
            <ul style={{ listStyle: "none", padding: 0 }}>
              {services.map((service) => {
                const isSelected = service.id === selectedServiceId;
                return (
                  <li key={service.id} style={{ marginBottom: "var(--space-4)" }}>
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
                      <p style={{ margin: "var(--space-1) 0 0" }}>{service.description}</p>
                    )}
                    {isSelected && (
                      <div style={{ marginTop: "var(--space-2)" }}>
                        <h3 style={{ font: "var(--text-heading-sm)" }}>{tBooking("availableTimes")}</h3>
                        <SlotList
                          slots={slots ?? []}
                          practitionerId={practitionerProfile.id}
                          serviceId={service.id}
                          username={practitionerProfile.username!}
                          viewerRole={viewerRole}
                        />
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        )}

        <section style={{ marginTop: "var(--space-8)" }}>
          <h2 style={{ font: "var(--text-heading-md)" }}>{tReviews("reviewsTitle")}</h2>
          {averageRating !== null && (
            <p style={{ color: "#666" }}>
              {tReviews("averageRatingSummary", {
                average: averageRating.toFixed(1),
                count: reviews!.length,
              })}
            </p>
          )}
          {!reviews || reviews.length === 0 ? (
            <p style={{ color: "#666" }}>{tReviews("noReviewsYet")}</p>
          ) : (
            <ul style={{ listStyle: "none", padding: 0 }}>
              {reviews.map((review) => (
                <li key={review.id} style={{ marginBottom: "var(--space-4)", borderTop: "1px solid #eee", paddingTop: "var(--space-3)" }}>
                  <strong>{"★".repeat(review.rating)}{"☆".repeat(5 - review.rating)}</strong>
                  {" — "}
                  <span>{tReviews("verifiedUser")}</span>
                  {" · "}
                  <span style={{ color: "#666", font: "var(--text-body-sm)" }}>
                    {new Intl.DateTimeFormat(intlLocale, { dateStyle: "medium" }).format(new Date(review.created_at))}
                  </span>
                  {review.review_text && <p style={{ margin: "var(--space-1) 0 0" }}>{review.review_text}</p>}
                </li>
              ))}
            </ul>
          )}
        </section>
      </ContentContainer>
    </main>
  );
}
