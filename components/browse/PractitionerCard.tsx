"use client";

import { Star } from "lucide-react";
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
  topicLabels?: string[]; // already mapped to the viewer's locale by the caller
  // [] for a practitioner with no active services yet — renders nothing,
  // not a placeholder. Already mapped to the viewer's locale.
  deliveryTypeLabels?: string[];
  // Reused from practitioner_profiles.location (free text, e.g. "Sofia")
  // — null whenever a practitioner hasn't filled it in; renders nothing
  // rather than a placeholder, same as bio/avatar's existing null
  // handling on this card.
  location?: string | null;
};

const AVATAR_SIZE = 138; // Card 2a spec — a fixed decorative dimension, not a spacing value

// Card 2a — the selected final direction from
// design/design_handoff_browse_card_2a: centered composition, the photo
// as the true focal point, soft/no-border card, a quiet booking link.
// One shared card for the whole Browse grid — no per-caller markup
// variants, so every result renders identically regardless of which
// filter/sort state produced it.
export function PractitionerCard({ practitioner }: { practitioner: PractitionerCardData }) {
  const t = useTranslations("Reviews");
  const tBrowse = useTranslations("Browse");
  const initial = (practitioner.displayName || practitioner.username).charAt(0).toUpperCase();
  const profileHref = `/p/${practitioner.username}`;

  // A plain <div>, not a Link, at the top level — "Book a session" below
  // needs its own real link/button, and nesting an interactive element
  // inside another <a> is invalid HTML (and unreliable across browsers/
  // screen readers) even when both happen to point at the same
  // destination. The profile-navigation Link instead wraps just the
  // avatar/name/modality/chips/bio block; the CTA is a sibling, not a
  // descendant.
  return (
    <div
      style={{
        position: "relative",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        textAlign: "center",
        gap: "var(--space-3)", // spec: 11px — rounds to the nearest step, not worth its own token
        background: "var(--bg-surface)",
        borderRadius: "var(--radius-2xl)",
        boxShadow: "var(--shadow-card)",
        padding: "var(--card-padding-feature)",
      }}
    >
      {practitioner.averageRating !== null && (
        // Omitted entirely when there's no rating yet (new practitioners)
        // — never a placeholder/zero, which would read as untrustworthy.
        <span
          aria-label={t("ratingAriaLabel", { rating: practitioner.averageRating.toFixed(1) })}
          style={{
            position: "absolute",
            top: "var(--space-4)",
            right: "var(--space-4)",
            background: "var(--accent)",
            color: "var(--text-on-accent)",
            padding: "var(--badge-padding-sm)",
            borderRadius: "var(--radius-pill)",
            font: "var(--text-micro)",
          }}
        >
          <span aria-hidden="true" style={{ display: "inline-flex", alignItems: "center", gap: 3 }}>
            <Star size={12} fill="currentColor" /> {practitioner.averageRating.toFixed(1)}
          </span>
        </span>
      )}

      <Link
        href={profileHref}
        style={{ color: "inherit", textDecoration: "none", display: "flex", flexDirection: "column", alignItems: "center", gap: "var(--space-3)" }}
      >
        {practitioner.avatarUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={practitioner.avatarUrl}
            alt=""
            style={{
              width: AVATAR_SIZE,
              height: AVATAR_SIZE,
              borderRadius: "50%",
              overflow: "hidden",
              objectFit: "cover",
              // A softer, tighter lift than the card's own shadow —
              // an element's own overflow:hidden (for the circular clip)
              // doesn't clip its own box-shadow, so both can live on this
              // one <img>.
              boxShadow: "0 4px 14px hsl(var(--shadow-color) / .14)",
            }}
          />
        ) : (
          // Recessive, quiet treatment — a photo is the norm, so the
          // fallback is deliberately muted rather than competing with
          // photo cards in the same grid row.
          <div
            aria-hidden="true"
            style={{
              width: AVATAR_SIZE,
              height: AVATAR_SIZE,
              borderRadius: "50%",
              background: "linear-gradient(160deg, var(--bg-sunken), var(--bg-surface-2))",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "var(--accent-subtle-text)",
              opacity: 0.7,
              // One-off, single-use initial-letter size — not a
              // systemic role worth its own token.
              font: "600 2.8125rem var(--font-display)",
            }}
          >
            {initial}
          </div>
        )}

        <div>
          <div style={{ font: "var(--text-heading-sm)", fontWeight: 700, color: "var(--text-primary)" }}>
            {practitioner.displayName || `@${practitioner.username}`}
          </div>
          {practitioner.specialtyLabels.length > 0 && (
            <div style={{ font: "var(--text-body-xs)", color: "var(--text-tertiary)", letterSpacing: "0.02em", marginTop: "var(--space-1)" }}>
              {practitioner.specialtyLabels.join(" · ")}
            </div>
          )}
          {/* City + delivery type as one quiet line — both are "quick
              facts" in the same register as the specialty line above,
              not worth two separate rows. Renders nothing at all when
              neither is present, rather than an empty line. */}
          {(practitioner.location || (practitioner.deliveryTypeLabels && practitioner.deliveryTypeLabels.length > 0)) && (
            <div style={{ font: "var(--text-micro)", color: "var(--text-tertiary)", marginTop: "var(--space-1)" }}>
              {[practitioner.location, ...(practitioner.deliveryTypeLabels ?? [])].filter(Boolean).join(" · ")}
            </div>
          )}
        </div>

        {practitioner.topicLabels && practitioner.topicLabels.length > 0 && (
          <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "center", gap: "var(--space-2)" }}>
            {practitioner.topicLabels.map((label) => (
              <span
                key={label}
                style={{
                  background: "var(--accent-subtle)",
                  color: "var(--accent-subtle-text)",
                  font: "var(--text-micro)",
                  fontWeight: 600,
                  padding: "var(--badge-padding-sm)",
                  borderRadius: "var(--radius-pill)",
                }}
              >
                {label}
              </span>
            ))}
          </div>
        )}

        {practitioner.bio && (
          <p
            style={{
              margin: 0,
              font: "var(--text-body-xs)",
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

      <Link
        href={profileHref}
        style={{
          marginTop: "auto",
          paddingTop: "var(--space-2)",
          font: "var(--text-body-xs)",
          fontWeight: 600,
          color: "var(--accent)",
          textDecoration: "underline",
        }}
      >
        {tBrowse("bookSessionCta")}
      </Link>
    </div>
  );
}
