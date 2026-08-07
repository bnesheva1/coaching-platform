"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useTranslations, useLocale } from "next-intl";
import { Button } from "@/components/ui/Button";
import { StarRating } from "@/components/ui/StarRating";
import { SlotPicker } from "@/components/booking/SlotPicker";
import { BookingResultDialog } from "@/components/booking/BookingResultDialog";
import { EditableImage } from "./EditableImage";
import { EditableIdentity } from "./EditableIdentity";
import { EditableAbout } from "./EditableAbout";
import { EditableSpecialties } from "./EditableSpecialties";
import { EditableTopics } from "./EditableTopics";
import specialtiesData from "@/data/specialties.json";
import topicsData from "@/data/topics.json";
import rowStyles from "@/components/bookings/ResponsiveImageRow.module.css";
import styles from "./PractitionerProfileView.module.css";

const INTL_LOCALES: Record<string, string> = { bg: "bg-BG", en: "en-US" };

export type ProfileService = {
  id: string;
  name: string;
  description: string | null;
  durationMinutes: number;
  priceCents: number;
  currency: string;
  imageUrl: string | null;
  deliveryType: "online" | "in_person" | "phone";
};

export type ProfileReview = {
  id: string;
  rating: number;
  reviewText: string | null;
  createdAt: string;
};

export type PractitionerProfileViewProps = {
  isOwner: boolean;
  practitionerId: string;
  username: string | null;
  displayName: string;
  headline: string;
  location: string;
  bio: string;
  avatarUrl: string | null;
  bannerUrl: string | null;
  // Practitioner's own scheduling timezone (practitioner_profiles.timezone)
  // — shown under the facts card's "next available time" so a seeker
  // knows what that value actually means before they even get there.
  timezone: string;
  // The VIEWING client's own saved timezone (profiles.timezone), threaded
  // straight through to SlotPicker so booking slots render in the client's
  // zone, not the practitioner's. Null for guests / clients who haven't
  // set one — SlotPicker then falls back to browser-detected, then UTC.
  viewerSavedTimezone?: string | null;
  specialties: string[];
  topics: string[];
  services: ProfileService[];
  reviews: ProfileReview[];
  averageRating: number | null;
  // Pre-fetched per service (not just the currently-expanded one) —
  // expand/collapse is local client state now, not a `?service=`
  // navigation, so every tile's slots need to already be on hand. Also
  // the source for the facts card's "next available time" (the
  // earliest slot across every service — same source of truth as the
  // per-service tables below, not computed separately). Still safe to
  // wire up unconditionally even when isOwner is previewing, since
  // SlotPicker already gates the actual booking action on viewerRole.
  slotsByServiceId: Record<string, { startUtc: string }[]>;
  // The viewing client's own existing bookings with this practitioner
  // (any service, not scoped per-service like slotsByServiceId — a
  // booking is a fact about the practitioner's calendar). Always []
  // for a non-client viewer.
  ownBookings: { id: string; startUtc: string }[];
  bookingWindowDays: number;
  viewerRole: "client" | "practitioner" | null;
  // Distinct from isOwner above: isOwner is pinned false on the public
  // route by design (edit mode only ever lives on the dashboard tab),
  // but a practitioner can still be looking at their OWN public link
  // there. This is the real "is the viewer the profile owner" signal,
  // used only to word SlotPicker's practitioner-viewer dialog correctly.
  isOwnProfile: boolean;
  // Single source of truth (is_practitioner_bookable RPC), same one
  // Browse/search and the dashboard checklist use. The dashboard's own
  // edit-tab render of this component (isOwnProfile always true there)
  // passes true unconditionally — see that page's own comment — since
  // an owner editing their profile must never be gated by this.
  isBookable: boolean;
  justBooked: boolean;
  bookingErrorCode: string | null;
  paymentStatus: "processing" | "cancelled" | null;
  // The service a bookSlot redirect was for (every redirect target
  // carries ?service=<id> already) — opens that tile expanded and
  // scrolls it into view on mount, so the client lands looking at the
  // slot they just booked/tried to book, not the top of the page. null
  // on the dashboard's own edit-tab render (no redirect ever lands
  // there).
  initialExpandedServiceId: string | null;
  // Rendered only when isEditing (isOwner && mode === "edit") — the
  // owner's own management UI (Stripe Connect status, username/settings),
  // which used to render as unconditional siblings of this component on
  // the dashboard's Profile tab, meaning clicking "Preview" never
  // actually hid them. Passing them in as a slot, gated internally by
  // this component's own isEditing state, is what makes that structurally
  // impossible now — the public route simply never passes this prop.
  ownerOnlyContent?: ReactNode;
};

// Shared by both app/[locale]/p/[username]/page.tsx (isOwner always
// false — the public, static view) and
// app/[locale]/practitioner-dashboard/profile/page.tsx (isOwner always
// true — the LinkedIn-style editable view). Layout follows
// design/design_handoff_practitioner_profile_2a (direction 2a) —
// cover-style header, quote pulled out of the banner into the intro
// block, a dedicated facts card, no section rule lines.
export function PractitionerProfileView({
  isOwner,
  practitionerId,
  username,
  displayName,
  headline,
  location,
  bio,
  avatarUrl,
  bannerUrl,
  timezone,
  specialties,
  topics,
  services,
  reviews,
  averageRating,
  slotsByServiceId,
  ownBookings,
  bookingWindowDays,
  viewerRole,
  viewerSavedTimezone,
  isOwnProfile,
  isBookable,
  justBooked,
  bookingErrorCode,
  paymentStatus,
  initialExpandedServiceId,
  ownerOnlyContent,
}: PractitionerProfileViewProps) {
  const t = useTranslations("Profile");
  const tPublic = useTranslations("PublicProfile");
  const tReviews = useTranslations("Reviews");
  const locale = useLocale();
  const intlLocale = INTL_LOCALES[locale] ?? "en-US";
  const [mode, setMode] = useState<"view" | "edit">("view");
  const isEditing = isOwner && mode === "edit";
  // Purely local now — was a `?service=` search param, which meant
  // every expand/collapse was a real Next.js navigation (new RSC
  // payload, scroll position reset) and felt like a page reload/jump.
  // Slots for every service are already fetched up front (see the page
  // components), so there's nothing left to fetch on click. Seeded from
  // initialExpandedServiceId, not always null — a fresh page load right
  // after a bookSlot redirect should land with that service's tile
  // already open, not collapsed.
  const [expandedServiceId, setExpandedServiceId] = useState<string | null>(initialExpandedServiceId);
  const [reviewsExpanded, setReviewsExpanded] = useState(false);
  // Placeholder only — local, optimistic, not persisted anywhere yet.
  // No auth gate either: there's no real save/favourite backend to gate
  // access to. Wire this up to a real table + server action when the
  // feature itself is actually built.
  const [isSaved, setIsSaved] = useState(false);

  // Scrolls the services section into view on mount when the page was
  // loaded with a specific service in mind (i.e. right after a bookSlot
  // redirect) — otherwise the client lands at the top of the page and
  // has to notice/scroll to the now-expanded tile themselves. Mount-only:
  // initialExpandedServiceId is derived from the URL this page loaded
  // with, never changes afterward, so there's nothing to re-run this on.
  useEffect(() => {
    if (initialExpandedServiceId) {
      document.getElementById("services")?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const dedupedDeliveryTypes = Array.from(new Set(services.map((s) => s.deliveryType))) as (
    | "online"
    | "in_person"
    | "phone"
  )[];

  // Earliest slot across every service — same source of truth as the
  // per-service tables below the fold, not computed separately.
  // Formatted in the PRACTITIONER's own stated timezone (the caption
  // directly beneath it names that same zone), not the viewer's
  // detected one — this is a summary fact about the practitioner's
  // calendar, unlike SlotPicker's own internal chips, which convert to
  // the viewer's browser timezone for actual booking.
  const nextSlotStartUtc = Object.values(slotsByServiceId)
    .flat()
    .map((s) => s.startUtc)
    .sort()[0];
  const nextSlotLabel = nextSlotStartUtc
    ? new Intl.DateTimeFormat(intlLocale, {
        weekday: "short",
        day: "numeric",
        month: "long",
        hour: "numeric",
        minute: "2-digit",
        timeZone: timezone,
      }).format(new Date(nextSlotStartUtc))
    : null;

  // No width constraint or centering on the root element on purpose —
  // that's a page-level layout decision, not this shared component's to
  // make. The public route wants a centered, capped-width column; the
  // dashboard's Profile tab wants this to left-align with its own "Профил"
  // heading and expand to fill the available width instead. A max-width
  // + margin:auto baked in here previously forced the same centered
  // treatment on both, which broke the dashboard's alignment/width. See
  // p/[username]/page.tsx for the public route's own wrapper.
  return (
    <div>
      {/* Renders nothing on the dashboard's own edit-tab render of this
          component (justBooked/bookingErrorCode/paymentStatus are
          always false/null/null there) — only ever opens on the public
          route, and only for the outcome the redirect that brought the
          client here actually carries. */}
      <BookingResultDialog justBooked={justBooked} bookingErrorCode={bookingErrorCode} paymentStatus={paymentStatus} />
      {isOwner && (
        <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: "var(--space-4)" }}>
          <div style={{ display: "inline-flex", border: "1px solid var(--border-default)", borderRadius: "var(--radius-pill)", padding: 2 }}>
            <button
              type="button"
              onClick={() => setMode("view")}
              style={{
                font: "var(--text-label)",
                padding: "6px 14px",
                borderRadius: "var(--radius-pill)",
                border: "none",
                cursor: "pointer",
                background: mode === "view" ? "var(--accent)" : "transparent",
                color: mode === "view" ? "var(--text-on-accent)" : "var(--text-secondary)",
              }}
            >
              {t("modeView")}
            </button>
            <button
              type="button"
              onClick={() => setMode("edit")}
              style={{
                font: "var(--text-label)",
                padding: "6px 14px",
                borderRadius: "var(--radius-pill)",
                border: "none",
                cursor: "pointer",
                background: mode === "edit" ? "var(--accent)" : "transparent",
                color: mode === "edit" ? "var(--text-on-accent)" : "var(--text-secondary)",
              }}
            >
              {t("modeEdit")}
            </button>
          </div>
        </div>
      )}

      {/* Banner — no text inside. The pull-quote (headline) moved to
          the intro block below; a tall empty-feeling banner with text
          lost inside it was the main defect of the version this
          replaces. */}
      <div
        className={styles.banner}
        style={{
          position: "relative",
          borderRadius: "var(--radius-xl)",
          overflow: "hidden",
          background: bannerUrl ? undefined : "linear-gradient(105deg, oklch(94% 0.03 82), oklch(88% 0.065 72))",
        }}
      >
        {bannerUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={bannerUrl} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
        ) : (
          <div aria-hidden="true" className={styles.bannerAccent} />
        )}
        {isEditing && (
          <div style={{ position: "absolute", top: 14, right: 14 }}>
            <EditableImage kind="banner" label={t("editBanner")} removeLabel={t("removeBanner")} hasImage={!!bannerUrl}>
              <></>
            </EditableImage>
          </div>
        )}
      </div>

      {/* Header row: identity (portrait overlapping the banner) +
          quote/pills/save button on the left, facts card on the right —
          the facts card's top aligns with the portrait's top and
          overlaps the banner the same way (matching negative margin in
          the CSS module), only in view mode. Edit mode has no facts
          card, just the identity block followed by the editable
          specialty/topic sections, stacked. */}
      <div style={{ padding: "0 40px 34px" }}>
        <div className={styles.introRow}>
          <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 26 }}>
            {/* Identity row — portrait overlaps the banner's lower
                edge (cover-photo style); name + specialty line beside
                it on desktop, stacked beneath it on mobile. A flex
                container (not a plain block) so its own negative
                margin-top doesn't collapse through into this parent —
                only the identity row itself should shift up over the
                banner, not the quote/pills below it too. */}
            <div className={styles.identityRow}>
              <div className={styles.portrait} style={{ position: "relative", flex: "none" }}>
                {avatarUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={avatarUrl}
                    alt={displayName}
                    style={{ width: "100%", height: "100%", borderRadius: "50%", objectFit: "cover", border: "6px solid var(--bg-page)", boxShadow: "var(--shadow-md)" }}
                  />
                ) : (
                  <div
                    style={{
                      width: "100%",
                      height: "100%",
                      borderRadius: "50%",
                      border: "6px solid var(--bg-page)",
                      boxShadow: "var(--shadow-md)",
                      background: "var(--accent-subtle)",
                      color: "var(--accent-subtle-text)",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      font: "var(--text-heading-lg)",
                    }}
                  >
                    {displayName.charAt(0).toUpperCase()}
                  </div>
                )}
                {isEditing && (
                  <div style={{ position: "absolute", bottom: 0, right: 0 }}>
                    <EditableImage kind="avatar" label={t("editPhoto")} removeLabel={t("removePhoto")} hasImage={!!avatarUrl}>
                      <></>
                    </EditableImage>
                  </div>
                )}
              </div>

              {isEditing ? (
                <div style={{ paddingBottom: 12, flex: 1, minWidth: 0 }}>
                  <EditableIdentity displayName={displayName} headline={headline} location={location} />
                </div>
              ) : (
                <div style={{ paddingBottom: 12, display: "flex", flexDirection: "column", gap: 3 }}>
                  <h1 style={{ margin: 0, font: "var(--text-display-sm)", color: "var(--text-primary)" }}>{displayName}</h1>
                  {specialties.length > 0 && (
                    <span style={{ font: "600 14px var(--font-ui)", color: "var(--accent)" }}>
                      {specialties.map((key) => specialtyLabelFor(key, locale)).join(", ")}
                    </span>
                  )}
                </div>
              )}
            </div>

            {isEditing ? (
              <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
                <EditableSpecialties specialties={specialties} />
                <EditableTopics topics={topics} />
              </div>
            ) : (
              <>
              {headline && (
                <p style={{ margin: 0, font: "italic 400 20px/1.5 var(--font-display)", color: "var(--text-primary)", maxWidth: 440 }}>
                  &ldquo;{headline}&rdquo;
                </p>
              )}

              {(specialties.length > 0 || topics.length > 0) && (
                <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                  {specialties.length > 0 && (
                    <div className={styles.pillRow}>
                      <span
                        className={styles.pillLabel}
                        style={{ font: "var(--text-overline)", letterSpacing: "var(--letter-overline)", textTransform: "uppercase", color: "var(--text-tertiary)" }}
                      >
                        {tPublic("practicesLabel")}
                      </span>
                      <div style={{ flex: 1, minWidth: 0, display: "flex", gap: 8, flexWrap: "wrap" }}>
                        {specialties.map((key) => (
                          <span
                            key={key}
                            style={{ font: "600 12px var(--font-ui)", padding: "6px 14px", borderRadius: "var(--radius-pill)", background: "var(--accent)", color: "var(--text-on-accent)" }}
                          >
                            {specialtyLabelFor(key, locale)}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                  {topics.length > 0 && (
                    <div className={styles.pillRow}>
                      <span
                        className={styles.pillLabel}
                        style={{ font: "var(--text-overline)", letterSpacing: "var(--letter-overline)", textTransform: "uppercase", color: "var(--text-tertiary)" }}
                      >
                        {tPublic("topicsLabel")}
                      </span>
                      <div style={{ flex: 1, minWidth: 0, display: "flex", gap: 8, flexWrap: "wrap" }}>
                        {topics.map((key) => (
                          <span
                            key={key}
                            style={{ font: "500 12px var(--font-ui)", padding: "6px 14px", borderRadius: "var(--radius-pill)", background: "var(--bg-surface-2)", color: "var(--text-secondary)", boxShadow: "var(--shadow-sm)" }}
                          >
                            {topicLabelFor(key, locale)}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

              <div>
                <Button variant="surface" size="lg" onClick={() => setIsSaved((v) => !v)}>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                    <IconHeart filled={isSaved} />
                    {tPublic("savePractitioner")}
                  </span>
                </Button>
              </div>
              </>
            )}
          </div>

          {!isEditing && (
            // position: relative (not just the overlap margin) is what
            // actually puts this on top of the banner, not just next to
            // it — the banner has position:relative too (for its own
            // absolute-positioned decorative layer), which promotes
            // positioned elements into a later paint pass than static
            // ones regardless of DOM order. The portrait avoids this
            // the same way (.portrait is also position:relative);
            // without it here, the banner painted over the card despite
            // coming first in the markup.
            <div className={styles.factsCard} style={{ position: "relative" }}>
              <FactsCard
                averageRating={averageRating}
                reviewCount={reviews.length}
                deliveryTypes={dedupedDeliveryTypes}
                city={location}
                nextSlotLabel={nextSlotLabel}
                timezone={timezone}
              />
            </div>
          )}
        </div>
      </div>

      {/* Sections — spacing alone separates them, no rule lines. */}
      <div style={{ padding: "8px 40px 42px", display: "flex", flexDirection: "column", gap: 44 }}>
        {/* About */}
        <div>
          <h2 style={{ margin: "0 0 12px", font: "var(--text-heading-lg)", color: "var(--text-primary)" }}>{t("aboutHeading")}</h2>
          {isEditing ? (
            <EditableAbout bio={bio} />
          ) : bio ? (
            bio.split("\n\n").map((paragraph, i) => (
              <p key={i} style={{ margin: i === 0 ? 0 : "var(--space-2) 0 0", font: "var(--text-body-md)", color: "var(--text-secondary)" }}>
                {paragraph}
              </p>
            ))
          ) : (
            <p style={{ margin: 0, font: "var(--text-body-md)", color: "var(--text-tertiary)" }}>{t("aboutEmpty")}</p>
          )}
        </div>

        {/* Services */}
        <div id="services">
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
            <h2 style={{ margin: 0, font: "var(--text-heading-lg)", color: "var(--text-primary)" }}>{tPublic("servicesTitle")}</h2>
            {isEditing && (
              // A labeled button, not the small edit-pencil icon every
              // other section here uses — those all edit inline, on
              // this same page; this one navigates all the way to a
              // different tab, so it reads better as a clearer,
              // more deliberate action than a quiet icon would.
              <Button href="/practitioner-dashboard/services" variant="secondary" size="sm">
                {t("editServices")}
              </Button>
            )}
          </div>
          {/* A non-owner viewer (client, or another practitioner) on a
              currently-unbookable profile gets a single calm state
              instead of the whole booking mechanism. The owner
              previewing their OWN public link (isOwnProfile) always
              sees the real, functional preview regardless. Deliberately
              doesn't say WHY — is_practitioner_bookable is boolean-only
              on purpose. */}
          {!isOwnProfile && !isBookable ? (
            <div style={{ padding: "var(--space-6)", borderRadius: "var(--radius-lg)", border: "1px solid var(--border-subtle)", background: "var(--bg-surface-2)" }}>
              <p style={{ margin: 0, font: "var(--text-body-md)", color: "var(--text-secondary)" }}>{tPublic("notCurrentlyBookable")}</p>
            </div>
          ) : services.length === 0 ? (
            <p style={{ margin: 0, color: "var(--text-tertiary)" }}>{t("noServicesYet")}</p>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
              {services.map((service) => {
                const isSelected = service.id === expandedServiceId;
                return (
                  <div key={service.id} style={{ background: "var(--bg-surface)", borderRadius: "var(--radius-xl)", boxShadow: "var(--shadow-md)", padding: 20 }}>
                    <div className={rowStyles.row} style={{ gap: 20 }}>
                      {/* No image at all → no tile, no gradient
                          placeholder: the text column just takes the
                          full width instead, an intentional text-only
                          layout rather than a broken-looking gap. */}
                      {service.imageUrl && (
                        <div
                          className={rowStyles.tile}
                          style={{ "--tile-size": "152px", aspectRatio: "1 / 1", borderRadius: 12, overflow: "hidden" } as React.CSSProperties}
                        >
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={service.imageUrl} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                        </div>
                      )}
                      <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 6 }}>
                        <span style={{ font: "var(--text-heading-lg)", color: "var(--text-primary)" }}>{service.name}</span>
                        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                          <span style={{ font: "var(--text-body-sm)", color: "var(--text-tertiary)" }}>
                            {tPublic("serviceDuration", { minutes: service.durationMinutes })} ·{" "}
                            {new Intl.NumberFormat(intlLocale, { style: "currency", currency: service.currency }).format(service.priceCents / 100)}
                          </span>
                          <ModeBadge deliveryType={service.deliveryType} city={location} compact />
                        </div>
                        {service.description && (
                          <span style={{ font: "var(--text-body-sm)", color: "var(--text-secondary)" }}>{service.description}</span>
                        )}
                      </div>
                    </div>

                    {isSelected ? (
                      <div style={{ marginTop: 20 }}>
                        <SlotPicker
                          slots={slotsByServiceId[service.id] ?? []}
                          ownBookings={ownBookings}
                          practitionerId={practitionerId}
                          serviceId={service.id}
                          username={username ?? ""}
                          viewerRole={viewerRole}
                          isOwnProfile={isOwnProfile}
                          windowDays={bookingWindowDays}
                          viewerSavedTimezone={viewerSavedTimezone}
                          headerAction={
                            <button
                              type="button"
                              onClick={() => setExpandedServiceId(null)}
                              aria-expanded="true"
                              aria-controls={`slotpicker-${service.id}`}
                              style={{ font: "600 12px var(--font-ui)", color: "var(--accent)", background: "none", border: "none", cursor: "pointer", whiteSpace: "nowrap" }}
                            >
                              {t("hideDetails")} ⌃
                            </button>
                          }
                        />
                      </div>
                    ) : (
                      <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 14 }}>
                        <button
                          type="button"
                          onClick={() => setExpandedServiceId(service.id)}
                          aria-expanded="false"
                          aria-controls={`slotpicker-${service.id}`}
                          style={{ display: "inline-flex", alignItems: "center", gap: 7, font: "600 12px var(--font-ui)", color: "var(--accent)", background: "none", border: "none", cursor: "pointer" }}
                        >
                          <IconCalendar size={14} />
                          {t("seeAvailability")} ⌄
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Reviews */}
        <div id="reviews">
          <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: "var(--space-3)", marginBottom: 16 }}>
            <h2 style={{ margin: 0, font: "var(--text-heading-lg)", color: "var(--text-primary)" }}>{tReviews("reviewsTitle")}</h2>
            {averageRating !== null && (
              <span style={{ font: "var(--text-body-sm)", color: "var(--text-tertiary)", whiteSpace: "nowrap" }}>
                <b style={{ font: "700 15px var(--font-ui)", color: "var(--text-primary)" }}>{averageRating.toFixed(1)}</b>{" "}
                {tReviews("reviewCountBadge", { count: reviews.length })}
              </span>
            )}
          </div>

          {reviews.length === 0 ? (
            <p style={{ margin: 0, color: "var(--text-tertiary)" }}>{tReviews("noReviewsYet")}</p>
          ) : !reviewsExpanded ? (
            <>
              <div className={styles.reviewsGrid}>
                {reviews.slice(0, 6).map((review) => (
                  <div key={review.id} style={{ background: "var(--bg-surface)", borderRadius: "var(--radius-lg)", boxShadow: "var(--shadow-md)", padding: "16px 18px", display: "flex", flexDirection: "column", gap: 8 }}>
                    <span aria-label={tReviews("ratingAriaLabel", { rating: review.rating })} style={{ color: "var(--accent)" }}>
                      <StarRating rating={review.rating} size={14} />
                    </span>
                    <span style={{ flex: 1, font: "var(--text-body-sm)", color: "var(--text-secondary)" }}>{review.reviewText}</span>
                    <span style={{ font: "var(--text-caption)", color: "var(--text-tertiary)" }}>
                      {tReviews("verifiedUser")} · {new Intl.DateTimeFormat(intlLocale, { dateStyle: "medium" }).format(new Date(review.createdAt))}
                    </span>
                  </div>
                ))}
              </div>
              {reviews.length > 6 && (
                <div style={{ display: "flex", justifyContent: "center", marginTop: 18 }}>
                  <Button variant="surface" size="lg" onClick={() => setReviewsExpanded(true)}>
                    {tPublic("expandAllReviews", { count: reviews.length })}
                  </Button>
                </div>
              )}
            </>
          ) : (
            <>
              <div style={{ display: "flex", flexDirection: "column" }}>
                {reviews.map((review) => (
                  <div key={review.id} style={{ padding: "14px 0", borderTop: "1px solid var(--border-subtle)", display: "flex", flexDirection: "column", gap: 5 }}>
                    <span style={{ font: "var(--text-caption)", color: "var(--text-tertiary)" }}>
                      <span aria-label={tReviews("ratingAriaLabel", { rating: review.rating })} style={{ color: "var(--accent)" }}>
                        <StarRating rating={review.rating} size={14} />
                      </span>{" "}
                      — {tReviews("verifiedUser")} · {new Intl.DateTimeFormat(intlLocale, { dateStyle: "medium" }).format(new Date(review.createdAt))}
                    </span>
                    {review.reviewText && <span style={{ font: "var(--text-body-sm)", color: "var(--text-secondary)" }}>{review.reviewText}</span>}
                  </div>
                ))}
              </div>
              <div style={{ display: "flex", justifyContent: "center", marginTop: 18 }}>
                <Button variant="surface" size="lg" onClick={() => setReviewsExpanded(false)}>
                  {tPublic("collapseReviews")}
                </Button>
              </div>
            </>
          )}
        </div>

        {/* Owner-only management UI (Stripe Connect status, username/
            settings) — only ever rendered while actually editing, never
            in Preview and never on the public route (which doesn't pass
            this prop at all). See this prop's own comment for why. */}
        {isEditing && ownerOnlyContent && (
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-6)" }}>{ownerOnlyContent}</div>
        )}
      </div>
    </div>
  );
}

// The right-hand facts card in the intro block: rating (decorative
// stars + the real number/count as an accessible link to Reviews),
// delivery-mode badges, the next available slot (see this file's own
// comment on nextSlotLabel for why it's computed once, up top, not
// here), and the page's one gold CTA — the design is explicit that
// this button exists only here, not duplicated in the left column.
function FactsCard({
  averageRating,
  reviewCount,
  deliveryTypes,
  city,
  nextSlotLabel,
  timezone,
}: {
  averageRating: number | null;
  reviewCount: number;
  deliveryTypes: ("online" | "in_person" | "phone")[];
  city: string;
  nextSlotLabel: string | null;
  timezone: string;
}) {
  const t = useTranslations("Profile");
  const tPublic = useTranslations("PublicProfile");
  const tReviews = useTranslations("Reviews");

  return (
    <div style={{ background: "var(--bg-surface)", borderRadius: "var(--radius-lg)", boxShadow: "var(--shadow-md)", padding: 20, display: "flex", flexDirection: "column", gap: 18 }}>
      {averageRating !== null && (
        <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
          <span aria-hidden="true" style={{ color: "var(--accent)" }}>
            <StarRating rating={5} size={14} />
          </span>
          <span aria-hidden="true" style={{ font: "700 18px var(--font-ui)", color: "var(--text-primary)" }}>
            {averageRating.toFixed(1)}
          </span>
          {/* Visible text is just the count; the full sentence is the
              accessible name, so a screen reader gets "4.9 out of 5
              (26 reviews)" from one focusable control instead of the
              decorative stars/number above being read redundantly. */}
          <a
            href="#reviews"
            aria-label={tReviews("averageRatingSummary", { average: averageRating.toFixed(1), count: reviewCount })}
            style={{ font: "var(--text-caption)", textDecoration: "none" }}
          >
            {tReviews("reviewCountBadge", { count: reviewCount })}
          </a>
        </div>
      )}

      {deliveryTypes.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          {deliveryTypes.map((deliveryType) => (
            <ModeBadge key={deliveryType} deliveryType={deliveryType} city={city} />
          ))}
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <span
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            font: "var(--text-overline)",
            letterSpacing: "var(--letter-overline)",
            textTransform: "uppercase",
            color: "var(--text-tertiary)",
          }}
        >
          <IconCalendar size={13} color="currentColor" />
          {tPublic("nextAvailableSlotLabel")}
        </span>
        <span style={{ font: "400 19px/1.3 var(--font-display)", color: "var(--text-primary)" }}>
          {nextSlotLabel ?? tPublic("nextAvailableSlotEmpty")}
        </span>
        {nextSlotLabel && <span style={{ font: "var(--text-caption)", color: "var(--text-tertiary)" }}>{timezone}</span>}
      </div>

      <Button href="#services" variant="primary" size="lg" fullWidth>
        {t("seeAvailability")}
      </Button>
    </div>
  );
}

// city comes straight from practitioner_profiles.location — there's no
// dedicated city-only field in the schema, so whatever the practitioner
// entered there (typically "City, Country") is what renders after the
// em dash. Reused for both the facts card (regular size) and each
// service card's own single mode badge (compact size).
function ModeBadge({ deliveryType, city, compact = false }: { deliveryType: "online" | "in_person" | "phone"; city: string; compact?: boolean }) {
  const tPublic = useTranslations("PublicProfile");
  const tServices = useTranslations("Services");
  const size = compact ? 11 : 13;
  const icon =
    deliveryType === "online" ? <IconMonitor size={size} /> : deliveryType === "in_person" ? <IconMapPin size={size} /> : <IconPhone size={size} />;
  const label =
    deliveryType === "online"
      ? tServices("deliveryTypeOnline")
      : deliveryType === "in_person"
        ? city
          ? tPublic("modeInPerson", { city })
          : tServices("deliveryTypeInPerson")
        : tServices("deliveryTypePhone");
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        font: `600 ${compact ? "10.5px" : "11.5px"} var(--font-ui)`,
        padding: compact ? "3px 8px" : "5px 11px",
        borderRadius: "var(--radius-pill)",
        background: "var(--accent-subtle)",
        color: "var(--accent-subtle-text)",
      }}
    >
      {icon}
      {label}
    </span>
  );
}

// Inline SVG icons, Lucide-style (1.5-2px stroke, currentColor) — this
// app has no icon library (every icon elsewhere is a Unicode glyph),
// but the approved handoff specs these shapes explicitly, so they're
// hand-written here rather than substituted with a glyph.
function IconMonitor({ size = 13 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true" style={{ flex: "none" }}>
      <rect x="2" y="4" width="20" height="14" rx="2" />
      <path d="M8 21h8" />
    </svg>
  );
}

function IconMapPin({ size = 13 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true" style={{ flex: "none" }}>
      <path d="M12 21s7-6.1 7-11a7 7 0 1 0-14 0c0 4.9 7 11 7 11z" />
      <circle cx="12" cy="10" r="2.5" />
    </svg>
  );
}

// Not part of the approved mockup (it only illustrates online/in-person)
// but the schema supports a phone delivery type too, so this needs a
// matching-weight icon rather than silently reusing one of the other two.
function IconPhone({ size = 13 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true" style={{ flex: "none" }}>
      <path d="M4 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L14 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 2 6a2 2 0 0 1 2-2z" />
    </svg>
  );
}

function IconCalendar({ size = 17, color = "currentColor" }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" aria-hidden="true" style={{ flex: "none" }}>
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M8 3v4M16 3v4M3 10h18" />
    </svg>
  );
}

function IconHeart({ size = 15, filled = false }: { size?: number; filled?: boolean }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill={filled ? "var(--accent)" : "none"} stroke="var(--accent)" strokeWidth="2" aria-hidden="true" style={{ flex: "none" }}>
      <path d="M20.8 8.6a5 5 0 0 0-8.8-3 5 5 0 0 0-8.8 3c0 5 8.8 10.4 8.8 10.4s8.8-5.4 8.8-10.4z" />
    </svg>
  );
}

function specialtyLabelFor(key: string, locale: string): string {
  return specialtiesData.find((s) => s.key === key)?.[locale as "en" | "bg"] ?? key;
}

function topicLabelFor(key: string, locale: string): string {
  return topicsData.find((topic) => topic.key === key)?.[locale as "en" | "bg"] ?? key;
}
