"use client";

import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";

export type PractitionerCardData = {
  id: string;
  username: string;
  displayName: string | null;
  bio: string | null;
  avatarUrl: string | null;
  specialtyLabels: string[]; // already mapped to the viewer's locale by the caller
  averageRating: number | null;
  reviewCount: number;
  // Not populated by anything yet (see the topics-field decision) — kept
  // as an optional prop so a future topic-chip row is an additive change
  // to this component, not a rewrite.
  topicLabels?: string[];
};

// One shared card for the whole Browse grid — no per-caller markup
// variants, so every result renders identically regardless of which
// filter/sort state produced it.
export function PractitionerCard({ practitioner }: { practitioner: PractitionerCardData }) {
  const t = useTranslations("Reviews");
  const tBrowse = useTranslations("Browse");
  const initial = (practitioner.displayName || practitioner.username).charAt(0).toUpperCase();
  const profileHref = `/p/${practitioner.username}`;

  // A plain <div>, not a Link, at the top level now — "Book a session"
  // below needs its own real link/button, and nesting an interactive
  // element inside another <a> is invalid HTML (and unreliable across
  // browsers/screen readers) even when both happen to point at the same
  // destination. The profile-navigation Link instead wraps just the
  // avatar/name/bio block; the CTA is a sibling, not a descendant.
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "var(--space-2)",
        padding: "var(--space-3)",
        borderRadius: "var(--radius-lg)",
        background: "var(--bg-surface)",
        border: "1px solid var(--border-subtle)",
        position: "relative",
      }}
    >
      <Link
        href={profileHref}
        style={{ color: "inherit", textDecoration: "none", display: "flex", flexDirection: "column", gap: "var(--space-2)" }}
      >
        <div style={{ display: "flex", gap: "var(--space-3)" }}>
          <div
            style={{
              width: 72,
              height: 72,
              flexShrink: 0,
              borderRadius: "50%",
              overflow: "hidden",
              background: "var(--accent-subtle)",
              color: "var(--accent-subtle-text)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              font: "var(--text-heading-md)",
            }}
          >
            {practitioner.avatarUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={practitioner.avatarUrl}
                alt=""
                style={{ width: "100%", height: "100%", objectFit: "cover" }}
              />
            ) : (
              initial
            )}
          </div>

          <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: "var(--space-1)" }}>
            {/* Reserved space for the rating badge above (absolutely
                positioned in the card's own top-right corner, not this
                column) — present unconditionally, whether or not THIS
                card actually has a rating, so every card's name starts
                at the same height and the grid stays visually aligned
                regardless of which cards happen to have reviews yet. */}
            <div aria-hidden="true" style={{ height: "1.5rem" }} />
            {/* Own row, below the reserved badge space — no
                white-space:nowrap/ellipsis/truncation, a long name wraps
                onto as many lines as it needs (e.g. "Виктория
                Илиева-Дългоимётова" in full) rather than clipping. */}
            <span style={{ font: "700 var(--text-body-md)", color: "var(--text-primary)" }}>
              {practitioner.displayName || `@${practitioner.username}`}
            </span>
            {practitioner.specialtyLabels.length > 0 && (
              <span style={{ font: "var(--text-caption)", color: "var(--text-tertiary)" }}>
                {practitioner.specialtyLabels.join(" · ")}
              </span>
            )}
            {practitioner.topicLabels && practitioner.topicLabels.length > 0 && (
              <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--space-1)" }}>
                {practitioner.topicLabels.map((label) => (
                  <span
                    key={label}
                    style={{
                      background: "var(--accent-subtle)",
                      color: "var(--accent-subtle-text)",
                      font: "600 var(--text-caption)",
                      padding: "2px var(--space-2)",
                      borderRadius: "var(--radius-pill)",
                    }}
                  >
                    {label}
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Sibling of the avatar+name row above, not nested inside its
            text column — spans the card's full width instead of just
            the space next to the avatar. */}
        {practitioner.bio && (
          <p
            style={{
              margin: 0,
              font: "var(--text-body-sm)",
              color: "var(--text-secondary)",
              overflow: "hidden",
              display: "-webkit-box",
              WebkitLineClamp: 2,
              WebkitBoxOrient: "vertical",
            }}
          >
            {practitioner.bio}
          </p>
        )}
      </Link>

      {/* Its own row, right-aligned — a sibling of the profile Link
          above (see the top-level comment on why), not a button nested
          inside it. Same destination today (there's no dedicated
          booking-entry route yet, just the profile's own service tiles
          and slot picker), but a genuinely separate, independently
          labelled control. Styled as a plain text link (accent color +
          underline), not a solid button — same recipe as the "Изчистете"
          link in BrowseFilters.tsx, not Button.tsx's own chrome. */}
      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <Link href={profileHref} style={{ font: "600 var(--text-label)", color: "var(--accent)", textDecoration: "underline" }}>
          {tBrowse("bookSessionCta")}
        </Link>
      </div>

      {/* Hidden entirely rather than showing a "no ratings" placeholder
          — the design source doesn't define that state, and a
          practitioner with zero reviews has nothing honest to show in
          its place. */}
      {practitioner.averageRating !== null && (
        <span
          aria-label={t("ratingAriaLabel", { rating: practitioner.averageRating.toFixed(1) })}
          style={{
            position: "absolute",
            top: "var(--space-2)",
            right: "var(--space-2)",
            background: "var(--accent)",
            color: "var(--text-on-accent)",
            padding: "3px var(--space-2)",
            borderRadius: "var(--radius-pill)",
            font: "700 var(--text-caption)",
          }}
        >
          <span aria-hidden="true">★ {practitioner.averageRating.toFixed(1)}</span>
        </span>
      )}
    </div>
  );
}
