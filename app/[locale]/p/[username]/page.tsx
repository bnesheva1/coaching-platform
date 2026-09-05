import type { Metadata } from "next";
import { getSiteName } from "@/lib/brand";
import { notFound, permanentRedirect } from "next/navigation";
import { getPathname } from "@/i18n/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { createClient } from "@/lib/supabase/server";
import { getBookableSlots } from "@/lib/availability/slots";
import { BOOKING_WINDOW_DAYS } from "@/lib/availability/generateSlots";
import { isEnabled } from "@/lib/flags";
import { deliveryBadgesVisible } from "@/lib/delivery";
import { computeImmediateAvailability } from "@/lib/immediate/fit";
import { isPractitionerSaved } from "@/lib/practitioners/saved";
import { getOwnBookingsWithPractitioner } from "@/lib/bookings/ownBookings";
import { getSavedTimezone } from "@/lib/profile/savedTimezone";
import { ContentContainer } from "@/components/ui/ContentContainer";
import { PractitionerProfileView } from "@/components/practitioner-profile/PractitionerProfileView";
import { ProfileUnavailableNotice } from "@/components/practitioner-profile/ProfileUnavailableNotice";
import { localizedAlternates, profileMetaTitle, profileMetaDescription, SITE_URL } from "@/lib/seo";
import specialtiesData from "@/data/specialties.json";

// Per-profile metadata — the fix for every profile sharing the homepage's
// generic <title>. Keyword-first title (name + specialties) + a description
// from headline/bio (graceful when thin), plus canonical + hreflang. A
// small dedicated fetch (not the page's full data load); an unknown/old
// handle returns nothing here and the page itself handles the redirect/404.
export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string; username: string }>;
}): Promise<Metadata> {
  const { locale, username } = await params;
  const supabase = await createClient();
  const { data: pp } = await supabase
    .from("practitioner_profiles")
    .select("id, headline, bio, specialties, username")
    .eq("username", username.toLowerCase())
    .single();
  if (!pp) return {};

  // A fully-hidden practitioner (lapsed, no outstanding bookings) shouldn't be
  // indexed or advertised — the page itself serves a neutral "not listed"
  // notice, so keep search engines off it and skip the rich meta.
  const { data: fullyHidden } = await supabase.rpc("is_practitioner_fully_hidden", { target_practitioner_id: pp.id });
  if (fullyHidden) {
    return { robots: { index: false, follow: false } };
  }

  const [{ data: prof }, t, siteName] = await Promise.all([
    supabase.from("profiles").select("display_name").eq("id", pp.id).single(),
    getTranslations({ locale, namespace: "PublicProfile" }),
    getSiteName(locale),
  ]);
  const name = prof?.display_name || `@${pp.username}`;
  const labelByKey = new Map(specialtiesData.map((s) => [s.key, locale === "en" ? s.en : s.bg]));
  const specialtyLabels = ((pp.specialties as string[] | null) ?? [])
    .map((k) => labelByKey.get(k))
    .filter((l): l is string => Boolean(l))
    .slice(0, 3);

  return {
    title: profileMetaTitle(name, specialtyLabels, siteName),
    description: profileMetaDescription({
      headline: pp.headline,
      bio: pp.bio,
      fallback: t("metaDescriptionFallback", { name, site: siteName }),
    }),
    alternates: localizedAlternates(locale, `/p/${pp.username}`),
  };
}

// isOwner is always false here — even the practitioner viewing their
// own public link only ever sees the static view. Editing happens on
// the dashboard's Profile tab (practitioner-dashboard/profile/page.tsx),
// a separate route rendering the same shared component with isOwner
// true, per the explicit view/edit split this was built around.
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
  const locale = (await getLocale()) as "bg" | "en";

  const supabase = await createClient();

  const { data: practitionerProfile } = await supabase
    .from("practitioner_profiles")
    .select("id, bio, headline, location, specialties, topics, avatar_url, banner_url, username, timezone")
    .eq("username", normalizedUsername)
    .single();

  // No live match — but the handle may be a practitioner's PREVIOUS
  // username. If so, redirect to their current one so old links, bookmarks,
  // and stale search results keep resolving instead of 404-ing. Only a true
  // dead end (never-used handle) falls through to notFound().
  if (!practitionerProfile) {
    const { data: currentUsername } = await supabase.rpc("resolve_username_redirect", {
      candidate: normalizedUsername,
    });
    if (currentUsername) {
      // PERMANENT (308) redirect, not the previous temporary one: the old
      // handle is gone for good, so search engines should consolidate link
      // equity onto the current URL and treat it as canonical. (Next's
      // permanentRedirect emits 308, which Google treats as permanent, the
      // same as 301.)
      permanentRedirect(getPathname({ href: `/p/${currentUsername}`, locale }));
    }
    notFound();
  }

  // Lapse stage two: a lapsed practitioner with no outstanding bookings is fully
  // hidden — the direct link stops working too, replaced by a quiet "not
  // currently listed" notice (never a 404 — the username stays reserved and they
  // may return; one successful payment restores this instantly). While any
  // booking is still outstanding this is false, so clients with a session to
  // keep can always reach them.
  const { data: fullyHidden } = await supabase.rpc("is_practitioner_fully_hidden", {
    target_practitioner_id: practitionerProfile.id,
  });
  if (fullyHidden) {
    return <ProfileUnavailableNotice />;
  }

  const [{ data: profile }, { data: services }, { data: authData }, { data: reviews }, { data: isBookable }, { data: galleryRows }] =
    await Promise.all([
      supabase.from("profiles").select("display_name").eq("id", practitionerProfile.id).single(),
      supabase
        .from("services")
        .select("id, name, description, duration_minutes, price_cents, currency, image_url, delivery_type")
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
      // Boolean-only, single source of truth shared with Browse/search
      // and the practitioner's own dashboard checklist — never exposes
      // WHICH condition failed, just whether this profile can book at
      // all right now.
      supabase.rpc("is_practitioner_bookable", { target_practitioner_id: practitionerProfile.id }),
      // Gallery images (public content), in display order.
      supabase
        .from("practitioner_gallery")
        .select("id, image_url, caption")
        .eq("practitioner_id", practitionerProfile.id)
        .order("position", { ascending: true }),
    ]);

  const averageRating =
    reviews && reviews.length > 0
      ? reviews.reduce((sum, r) => sum + r.rating, 0) / reviews.length
      : null;

  // The VIEWER's own role (not the practitioner-being-viewed's) —
  // determines whether SlotPicker shows real book buttons, an
  // "only clients can book" note, or a log-in prompt. Can't be part of
  // the Promise.all above since it depends on that call's own result.
  const { data: viewerProfile } = authData.user
    ? await supabase.from("profiles").select("role").eq("id", authData.user.id).single()
    : { data: null };
  // The viewing client's own saved timezone, if any — passed down so slot
  // times render in the client's zone, not the practitioner's. Read via
  // service role since timezone is excluded from the client column grant.
  const viewerSavedTimezone = authData.user ? await getSavedTimezone(authData.user.id) : null;
  const viewerRole: "client" | "practitioner" | null =
    viewerProfile?.role === "client" || viewerProfile?.role === "practitioner"
      ? viewerProfile.role
      : null;
  // Separate from the isOwner prop below (always false here, by design —
  // see its own comment) — this is whether the practitioner viewing this
  // page IS the practitioner it belongs to, used only to word SlotPicker's
  // practitioner-viewer dialog ("preview" vs "only clients can book").
  const isOwnProfile = authData.user?.id === practitionerProfile.id;

  // Only a client can structurally have "own bookings" with this
  // practitioner to mark on the picker — RLS itself also scopes this to
  // the caller's own rows (see getOwnBookingsWithPractitioner), but
  // skipping the query entirely for every other viewerRole avoids a
  // pointless round trip.
  const ownBookings =
    viewerRole === "client"
      ? await getOwnBookingsWithPractitioner({ practitionerId: practitionerProfile.id })
      : [];

  // One slot fetch per active service, up front — the expand/collapse
  // toggle on each tile is now purely local client state (no more
  // `?service=` navigation, which was the "page jumps" / feels-like-a-
  // reload problem), so the data has to already be on hand rather than
  // fetched reactively off a search param. Services lists here are
  // small in practice; this trades a slightly larger initial page load
  // for an instant, smooth expand with no network wait at all.
  const slotsByServiceId = Object.fromEntries(
    await Promise.all(
      (services ?? []).map(async (s) => [
        s.id,
        await getBookableSlots({ practitionerId: practitionerProfile.id, serviceId: s.id }),
      ]),
    ),
  ) as Record<string, { startUtc: string }[]>;

  // Immediate booking discovery (behind the flag): is this practitioner
  // available right now, and — if so — which of their services currently fit an
  // immediate session's gap. Computed at request time; staleness across the
  // page's lifetime is acceptable (a lapsed request costs the client nothing).
  const immediateOn = await isEnabled("immediateBooking");
  let availableNow = false;
  let immediateFitByServiceId: Record<string, boolean> = {};
  if (immediateOn) {
    const { data: present } = await supabase.rpc("is_practitioner_available_now", { target: practitionerProfile.id });
    if (present) {
      // Bookability, not just presence — the marker and the per-service book-now
      // both gate on a service actually fitting an immediate session right now.
      const avail = await computeImmediateAvailability(practitionerProfile.id);
      immediateFitByServiceId = Object.fromEntries(
        (services ?? []).map((s) => [s.id, avail.bookableServiceIds.includes(s.id)]),
      );
      availableNow = avail.bookableServiceIds.length > 0;
    }
  }

  // Whether the viewing client has already saved this practitioner (initial state
  // for the save toggle). Only a client has a saved list.
  const viewerHasSaved = viewerRole === "client" ? await isPractitionerSaved(practitionerProfile.id) : false;

  const justBooked = resolvedSearchParams.booked === "1";
  const bookingErrorCode =
    typeof resolvedSearchParams.bookingError === "string" ? resolvedSearchParams.bookingError : null;
  // Every bookSlot redirect back to this page already carries the
  // service the attempt was for — previously never read, so the client
  // landed back at the top of the page with the whole accordion
  // collapsed, no indication of which tile the outcome even applied to.
  const initialExpandedServiceId =
    typeof resolvedSearchParams.service === "string" ? resolvedSearchParams.service : null;
  // Epic 9: the commission-model path redirects back here straight from
  // Stripe, before the webhook has necessarily finished creating the
  // booking — "processing" is deliberately non-committal (never "your
  // booking is confirmed"), since that confirmation only ever comes
  // from the email the webhook sends once it actually exists.
  const paymentStatus =
    resolvedSearchParams.payment === "processing" || resolvedSearchParams.payment === "cancelled"
      ? resolvedSearchParams.payment
      : null;

  // ---- Structured data (schema.org JSON-LD) ----
  // Built entirely from data already fetched/shown above; nothing invented.
  const [tProfile, siteName] = await Promise.all([
    getTranslations("PublicProfile"),
    getSiteName(locale),
  ]);
  const displayName = profile?.display_name || `@${practitionerProfile.username}`;
  const canonicalUrl = `${SITE_URL}${getPathname({ href: `/p/${practitionerProfile.username}`, locale })}`;
  const specialtyLabelByKey = new Map(
    specialtiesData.map((s) => [s.key, locale === "en" ? s.en : s.bg]),
  );
  const specialtyLabels = ((practitionerProfile.specialties as string[] | null) ?? [])
    .map((k) => specialtyLabelByKey.get(k))
    .filter((l): l is string => Boolean(l));
  const descriptionText = profileMetaDescription({
    headline: practitionerProfile.headline,
    bio: practitionerProfile.bio,
    fallback: tProfile("metaDescriptionFallback", { name: displayName, site: siteName }),
  });
  const locationText = practitionerProfile.location?.trim();

  // Person by default; LocalBusiness when a location exists (the star-
  // eligible type). Both carry the same properties here.
  const practitionerEntity = {
    "@type": locationText ? "LocalBusiness" : "Person",
    "@id": `${canonicalUrl}#practitioner`,
    name: displayName,
    url: canonicalUrl,
    description: descriptionText,
    ...(practitionerProfile.avatar_url ? { image: practitionerProfile.avatar_url } : {}),
    ...(specialtyLabels.length > 0 ? { knowsAbout: specialtyLabels } : {}),
    ...(locationText ? { address: { "@type": "PostalAddress", addressLocality: locationText } } : {}),
    // ONLY from genuine reviews — omitted entirely when there are none, never
    // a default or zero rating.
    ...(averageRating !== null && reviews && reviews.length > 0
      ? {
          aggregateRating: {
            "@type": "AggregateRating",
            ratingValue: Number(averageRating.toFixed(1)),
            reviewCount: reviews.length,
            bestRating: 5,
            worstRating: 1,
          },
        }
      : {}),
    // Price maps cleanly onto Offer; schema.org has no standard session-
    // length field on Service/Offer, so duration stays in the visible page
    // text rather than being forced into an invented property.
    ...((services ?? []).length > 0
      ? {
          makesOffer: (services ?? []).map((s) => ({
            "@type": "Offer",
            priceCurrency: s.currency,
            price: (s.price_cents / 100).toFixed(2),
            itemOffered: {
              "@type": "Service",
              name: s.name,
              ...(s.description ? { description: s.description } : {}),
            },
          })),
        }
      : {}),
  };

  const breadcrumb = {
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: tProfile("breadcrumbHome"), item: `${SITE_URL}${getPathname({ href: "/", locale })}` },
      { "@type": "ListItem", position: 2, name: tProfile("breadcrumbBrowse"), item: `${SITE_URL}${getPathname({ href: "/browse", locale })}` },
      { "@type": "ListItem", position: 3, name: displayName, item: canonicalUrl },
    ],
  };

  const jsonLd = { "@context": "https://schema.org", "@graph": [practitionerEntity, breadcrumb] };
  const jsonLdScript = JSON.stringify(jsonLd).replace(/</g, "\\u003c");

  return (
    <main style={{ padding: "var(--space-8) 0" }}>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdScript }} />
      <ContentContainer maxWidth={"var(--content-max-width)"}>
        {/* Centered, capped-width reading column for the public route
            specifically — PractitionerProfileView itself no longer
            applies this, since the dashboard's own Profile tab
            (practitioner-dashboard/profile/page.tsx) wants the
            opposite: left-aligned, filling the available width. */}
        <div style={{ maxWidth: 900, margin: "0 auto" }}>
        <PractitionerProfileView
          isOwner={false}
          practitionerId={practitionerProfile.id}
          username={practitionerProfile.username}
          displayName={profile?.display_name || `@${practitionerProfile.username}`}
          headline={practitionerProfile.headline ?? ""}
          location={practitionerProfile.location ?? ""}
          bio={practitionerProfile.bio ?? ""}
          avatarUrl={practitionerProfile.avatar_url}
          bannerUrl={practitionerProfile.banner_url}
          timezone={practitionerProfile.timezone}
          specialties={practitionerProfile.specialties ?? []}
          topics={practitionerProfile.topics ?? []}
          services={(services ?? []).map((s) => ({
            id: s.id,
            name: s.name,
            description: s.description,
            durationMinutes: s.duration_minutes,
            priceCents: s.price_cents,
            currency: s.currency,
            imageUrl: s.image_url,
            deliveryType: s.delivery_type,
          }))}
          reviews={(reviews ?? []).map((r) => ({
            id: r.id,
            rating: r.rating,
            reviewText: r.review_text,
            createdAt: r.created_at,
          }))}
          averageRating={averageRating}
          slotsByServiceId={slotsByServiceId}
          ownBookings={ownBookings}
          bookingWindowDays={BOOKING_WINDOW_DAYS}
          viewerRole={viewerRole}
          viewerSavedTimezone={viewerSavedTimezone}
          isOwnProfile={isOwnProfile}
          isBookable={isBookable ?? false}
          justBooked={justBooked}
          bookingErrorCode={bookingErrorCode}
          paymentStatus={paymentStatus}
          initialExpandedServiceId={initialExpandedServiceId}
          availableNow={availableNow}
          immediateFitByServiceId={immediateFitByServiceId}
          viewerHasSaved={viewerHasSaved}
          showDeliveryBadges={deliveryBadgesVisible()}
          gallery={(galleryRows ?? []).map((g) => ({ id: g.id, imageUrl: g.image_url, caption: g.caption }))}
        />
        </div>
      </ContentContainer>
    </main>
  );
}
