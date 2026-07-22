"use client";

import { useState } from "react";
import { useTranslations, useLocale } from "next-intl";
import { Link } from "@/i18n/navigation";
import { Button } from "@/components/ui/Button";
import { SlotPicker } from "@/components/booking/SlotPicker";
import { EditableImage } from "./EditableImage";
import { EditableIdentity } from "./EditableIdentity";
import { EditableAbout } from "./EditableAbout";
import { EditableSpecialties } from "./EditableSpecialties";
import specialtiesData from "@/data/specialties.json";

const INTL_LOCALES: Record<string, string> = { bg: "bg-BG", en: "en-US" };

export type ProfileService = {
  id: string;
  name: string;
  description: string | null;
  durationMinutes: number;
  priceCents: number;
  currency: string;
  imageUrl: string | null;
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
  specialties: string[];
  services: ProfileService[];
  reviews: ProfileReview[];
  averageRating: number | null;
  // Pre-fetched per service (not just the currently-expanded one) —
  // expand/collapse is local client state now, not a `?service=`
  // navigation, so every tile's slots need to already be on hand. Still
  // safe to wire up unconditionally even when isOwner is previewing,
  // since SlotPicker already gates the actual booking action on
  // viewerRole (a practitioner previewing their own profile just sees
  // "only clients can book", same as viewing anyone else's).
  slotsByServiceId: Record<string, { startUtc: string }[]>;
  // The viewing client's own existing bookings with this practitioner
  // (any service, not scoped per-service like slotsByServiceId — a
  // booking is a fact about the practitioner's calendar). Always []
  // for a non-client viewer.
  ownBookings: { id: string; startUtc: string }[];
  bookingWindowDays: number;
  viewerRole: "client" | "practitioner" | null;
  justBooked: boolean;
  bookingErrorCode: string | null;
};

// Shared by both app/[locale]/p/[username]/page.tsx (isOwner always
// false — the public, static view) and
// app/[locale]/practitioner-dashboard/profile/page.tsx (isOwner always
// true — the LinkedIn-style editable view). The isOwner/mode split
// mirrors the approved design source exactly: only an owner ever sees
// the Preview/Edit toggle or any pencil.
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
  specialties,
  services,
  reviews,
  averageRating,
  slotsByServiceId,
  ownBookings,
  bookingWindowDays,
  viewerRole,
  justBooked,
  bookingErrorCode,
}: PractitionerProfileViewProps) {
  const t = useTranslations("Profile");
  const tPublic = useTranslations("PublicProfile");
  const tBooking = useTranslations("Booking");
  const tReviews = useTranslations("Reviews");
  const locale = useLocale();
  const intlLocale = INTL_LOCALES[locale] ?? "en-US";
  const [mode, setMode] = useState<"view" | "edit">("view");
  const isEditing = isOwner && mode === "edit";
  // Purely local now — was a `?service=` search param, which meant
  // every expand/collapse was a real Next.js navigation (new RSC
  // payload, scroll position reset) and felt like a page reload/jump.
  // Slots for every service are already fetched up front (see the page
  // components), so there's nothing left to fetch on click.
  const [expandedServiceId, setExpandedServiceId] = useState<string | null>(null);

  return (
    <div>
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

      {/* Banner */}
      <div style={{ position: "relative", height: 180, borderRadius: "var(--radius-xl)", overflow: "hidden", background: bannerUrl ? undefined : "linear-gradient(135deg, var(--bg-sunken), var(--accent-glow))" }}>
        {bannerUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={bannerUrl} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
        )}
        {isEditing && (
          <div style={{ position: "absolute", top: 14, right: 14 }}>
            <EditableImage kind="banner" label={t("editBanner")}>
              <></>
            </EditableImage>
          </div>
        )}
      </div>

      {/* Identity block — avatar overlaps the banner seam */}
      <div style={{ display: "flex", alignItems: "flex-end", gap: "var(--space-4)", marginTop: -48, marginLeft: "var(--space-4)" }}>
        <div style={{ position: "relative" }}>
          {avatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={avatarUrl}
              alt={displayName}
              style={{ width: 96, height: 96, borderRadius: "50%", objectFit: "cover", border: "4px solid var(--bg-page)" }}
            />
          ) : (
            <div
              style={{
                width: 96,
                height: 96,
                borderRadius: "50%",
                border: "4px solid var(--bg-page)",
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
              <EditableImage kind="avatar" label={t("editPhoto")}>
                <></>
              </EditableImage>
            </div>
          )}
        </div>
      </div>

      <div style={{ padding: "var(--space-4)" }}>
        {isEditing ? (
          <EditableIdentity displayName={displayName} headline={headline} location={location} />
        ) : (
          <div>
            <h1 style={{ font: "var(--text-heading-lg)", margin: 0 }}>{displayName}</h1>
            {/* Placeholder text only for the owner (previewing their own,
                still-incomplete profile) — a real visitor never sees an
                "add a headline" nudge; the line is simply omitted for
                them, same as before. */}
            {headline ? (
              <p style={{ font: "var(--text-body-md)", color: "var(--text-secondary)", margin: "var(--space-1) 0 0" }}>{headline}</p>
            ) : (
              isOwner && <p style={{ font: "var(--text-body-md)", color: "var(--text-tertiary)", fontStyle: "italic", margin: "var(--space-1) 0 0" }}>{t("headlinePlaceholder")}</p>
            )}
            {location ? (
              <p style={{ font: "var(--text-body-sm)", color: "var(--text-tertiary)", margin: "var(--space-1) 0 0" }}>{location}</p>
            ) : (
              isOwner && <p style={{ font: "var(--text-body-sm)", color: "var(--text-tertiary)", fontStyle: "italic", margin: "var(--space-1) 0 0" }}>{t("locationPlaceholder")}</p>
            )}
          </div>
        )}

        <div style={{ margin: "var(--space-3) 0" }}>
          {isEditing ? (
            <EditableSpecialties specialties={specialties} />
          ) : (
            specialties.length > 0 && (
              <div style={{ display: "flex", gap: "var(--space-2)", flexWrap: "wrap" }}>
                {specialties.map((key) => (
                  <span
                    key={key}
                    style={{
                      font: "var(--text-label)",
                      padding: "6px 14px",
                      borderRadius: "var(--radius-pill)",
                      border: "1px solid var(--border-default)",
                      color: "var(--text-secondary)",
                    }}
                  >
                    {specialtyLabelFor(key, locale)}
                  </span>
                ))}
              </div>
            )
          )}
        </div>

        {averageRating !== null && (
          <p style={{ font: "var(--text-body-sm)", color: "var(--text-secondary)" }}>
            {tReviews("averageRatingSummary", { average: averageRating.toFixed(1), count: reviews.length })}
          </p>
        )}

        {!isEditing && (
          <div style={{ display: "flex", gap: "var(--space-2)", marginTop: "var(--space-3)" }}>
            <Button href="#services" variant="primary" size="sm">
              {t("seeAvailability")}
            </Button>
          </div>
        )}

        {/* About */}
        <section style={{ marginTop: "var(--space-8)" }}>
          <h2 style={{ font: "var(--text-heading-md)" }}>{t("aboutHeading")}</h2>
          {isEditing ? <EditableAbout bio={bio} /> : (
            <>
              {bio ? (
                bio.split("\n\n").map((paragraph, i) => (
                  <p key={i} style={{ font: "var(--text-body-md)", color: "var(--text-secondary)" }}>
                    {paragraph}
                  </p>
                ))
              ) : (
                <p style={{ font: "var(--text-body-md)", color: "var(--text-tertiary)" }}>{t("aboutEmpty")}</p>
              )}
            </>
          )}
        </section>

        {/* Services */}
        <section id="services" style={{ marginTop: "var(--space-8)" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <h2 style={{ font: "var(--text-heading-md)" }}>{tPublic("servicesTitle")}</h2>
            {isEditing && (
              <Link href="/practitioner-dashboard/services" aria-label={t("editServices")}>
                <EditPencilButtonAsLink label={t("editServices")} />
              </Link>
            )}
          </div>
          {/* visibility, not conditional unmount — expanding a tile
              still hides the text (it's no longer relevant once a
              service is picked), but keeps its line height reserved so
              the services list above doesn't jump up when it
              disappears and back down when it reappears. */}
          {services.length > 0 && (
            <p
              style={{
                font: "var(--text-body-sm)",
                color: "var(--text-tertiary)",
                visibility: expandedServiceId ? "hidden" : "visible",
              }}
            >
              {tBooking("selectService")}
            </p>
          )}
          {justBooked && <p style={{ color: "green" }}>{tBooking("bookingConfirmed")}</p>}
          {bookingErrorCode && (
            <p style={{ color: "crimson" }}>
              {tBooking.has(bookingErrorCode) ? tBooking(bookingErrorCode as Parameters<typeof tBooking>[0]) : tBooking("bookingFailed")}
            </p>
          )}
          {services.length === 0 ? (
            <p style={{ color: "var(--text-tertiary)" }}>{t("noServicesYet")}</p>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
              {services.map((service) => {
                const isSelected = service.id === expandedServiceId;
                return (
                  <div
                    key={service.id}
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      padding: "var(--space-4)",
                      borderRadius: "var(--radius-lg)",
                      border: "1px solid var(--border-subtle)",
                      background: "var(--bg-surface)",
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        // flex-start, not the flex default (stretch) —
                        // keeps the image square regardless of how tall
                        // the text column next to it gets.
                        alignItems: "flex-start",
                        gap: "var(--space-4)",
                      }}
                    >
                      {/* Square thumbnail, capped at a third of the tile's
                          width — flex-basis (not a fixed px width) so it
                          scales with the tile rather than overflowing on
                          narrow screens. No upload UI exists yet for this
                          (see the plan's note); shows a placeholder until
                          one does, same treatment as the banner. */}
                      <div
                        style={{
                          flex: "0 0 33%",
                          maxWidth: "33%",
                          aspectRatio: "1 / 1",
                          borderRadius: "var(--radius-md)",
                          overflow: "hidden",
                          background: service.imageUrl ? undefined : "linear-gradient(135deg, var(--bg-sunken), var(--accent-glow))",
                        }}
                      >
                        {service.imageUrl && (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={service.imageUrl} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                        )}
                      </div>

                      <div style={{ flex: 1, minWidth: 0 }}>
                        <strong>{service.name}</strong>
                        <p style={{ margin: "var(--space-1) 0", font: "var(--text-body-sm)", color: "var(--text-secondary)" }}>
                          {tPublic("serviceDuration", { minutes: service.durationMinutes })} ·{" "}
                          {new Intl.NumberFormat(intlLocale, { style: "currency", currency: service.currency }).format(service.priceCents / 100)}
                        </p>
                        {/* Always visible, not gated behind expand — only
                            the timetable is deferred until you ask for it. */}
                        {service.description && (
                          <p style={{ margin: "0 0 var(--space-2)", font: "var(--text-body-sm)", color: "var(--text-tertiary)" }}>{service.description}</p>
                        )}
                      </div>
                    </div>

                    {/* Full tile width, sitting directly above the
                        accordion it opens — not nested in the ~67% text
                        column above, so it reads as the hinge between
                        the collapsed summary and the expanded content
                        rather than just another line of tile text. Text
                        + a small chevron that flips on expand, rather
                        than a bordered button — reads as a disclosure
                        toggle (the chevron communicates "this expands"),
                        not an action button. A plain button + local
                        state, not a Link to `?service=` — that was a
                        real navigation on every click (new RSC payload,
                        scroll reset), which read as the page
                        reloading/jumping. */}
                    <button
                      type="button"
                      onClick={() => setExpandedServiceId(isSelected ? null : service.id)}
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        justifyContent: "flex-end",
                        gap: "var(--space-1)",
                        width: "100%",
                        marginTop: "var(--space-3)",
                        paddingTop: "var(--space-3)",
                        paddingLeft: 0,
                        paddingRight: 0,
                        paddingBottom: 0,
                        font: "var(--text-label)",
                        color: "var(--accent)",
                        background: "none",
                        border: "none",
                        borderTop: "1px solid var(--border-subtle)",
                        cursor: "pointer",
                      }}
                    >
                      {isSelected ? t("hideDetails") : t("seeDetailsAndAvailability")}
                      <span
                        aria-hidden
                        style={{
                          display: "inline-block",
                          // Smaller than the label text next to it,
                          // same --text-caption token used for the
                          // other small icon buttons on this page.
                          font: "var(--text-caption)",
                          transition: "transform var(--duration-fast) var(--ease-standard)",
                          transform: isSelected ? "rotate(180deg)" : "none",
                        }}
                      >
                        ⌄
                      </span>
                    </button>

                    {/* Sibling of the image+text row above, not nested
                        inside the text column — spans the tile's full
                        width instead of just the ~67% remaining next to
                        the image. max-height (not the content's real
                        height, which isn't known up front) is the
                        broadly-supported way to get a smooth CSS-only
                        expand — the slot timetable can get tall, so this
                        is generous enough that it never clips real
                        content; the transition timing is tuned around
                        that, not the actual height, which is the normal
                        tradeoff of this technique. */}
                    <div
                      style={{
                        display: "grid",
                        maxHeight: isSelected ? 3000 : 0,
                        opacity: isSelected ? 1 : 0,
                        overflow: "hidden",
                        transition: "max-height 0.4s var(--ease-standard), opacity 0.25s var(--ease-standard)",
                      }}
                    >
                      <div style={{ marginTop: "var(--space-3)" }}>
                        <SlotPicker
                          slots={slotsByServiceId[service.id] ?? []}
                          ownBookings={ownBookings}
                          practitionerId={practitionerId}
                          serviceId={service.id}
                          username={username ?? ""}
                          viewerRole={viewerRole}
                          windowDays={bookingWindowDays}
                        />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        {/* Reviews */}
        <section style={{ marginTop: "var(--space-8)" }}>
          <h2 style={{ font: "var(--text-heading-md)" }}>{tReviews("reviewsTitle")}</h2>
          {reviews.length === 0 ? (
            <p style={{ color: "var(--text-tertiary)" }}>{tReviews("noReviewsYet")}</p>
          ) : (
            <ul style={{ listStyle: "none", padding: 0 }}>
              {reviews.map((review) => (
                <li key={review.id} style={{ marginBottom: "var(--space-4)", borderTop: "1px solid var(--border-subtle)", paddingTop: "var(--space-3)" }}>
                  <strong>{"★".repeat(review.rating)}{"☆".repeat(5 - review.rating)}</strong>
                  {" — "}
                  <span>{tReviews("verifiedUser")}</span>
                  {" · "}
                  <span style={{ color: "var(--text-tertiary)", font: "var(--text-body-sm)" }}>
                    {new Intl.DateTimeFormat(intlLocale, { dateStyle: "medium" }).format(new Date(review.createdAt))}
                  </span>
                  {review.reviewText && <p style={{ margin: "var(--space-1) 0 0" }}>{review.reviewText}</p>}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}

function EditPencilButtonAsLink({ label }: { label: string }) {
  return (
    <span
      role="img"
      aria-label={label}
      style={{
        width: 26,
        height: 26,
        borderRadius: "50%",
        background: "var(--bg-surface)",
        border: "1px solid var(--border-default)",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        // Same sizing as EditPencilButton.tsx's 26px case (this is its
        // Link-wrapped twin, for the services section's edit affordance).
        font: "var(--text-caption)",
        color: "var(--text-secondary)",
        boxShadow: "var(--shadow-sm)",
      }}
    >
      ✎
    </span>
  );
}

function specialtyLabelFor(key: string, locale: string): string {
  return specialtiesData.find((s) => s.key === key)?.[locale as "en" | "bg"] ?? key;
}
