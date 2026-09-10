"use client";

import type { CSSProperties } from "react";
import { useTranslations } from "next-intl";
import { initialsFromName } from "@/lib/initials";

// One avatar, everywhere a practitioner's face appears clickable — so the
// "available now" indicator (a coloured ring + a small label) travels WITH the
// avatar rather than being re-implemented per surface. The ring is a sibling
// overlay (position:absolute, inset negative), never the image's own border, so
// it composes with whatever border/shadow each surface already puts on the
// avatar (the browse card's lift shadow, the profile portrait's page-coloured
// ring) without fighting it. i18n-agnostic: the caller passes `availableLabel`.
export type AvatarProps = {
  src?: string | null;
  name: string;
  size: number;
  // When the person this avatar represents has been deleted/anonymised, force
  // the neutral "?" glyph (ignoring any stale src or name-derived initials).
  deleted?: boolean;
  availableNow?: boolean;
  // The translated „На разположение сега" label; rendered beneath the avatar
  // only when set AND availableNow. Omit for surfaces that show the ring alone.
  availableLabel?: string;
  // Per-surface look for the initials fallback and the image frame, so each
  // caller keeps its existing avatar styling while sharing the ring behaviour.
  fallbackBackground?: string;
  fallbackColor?: string;
  fallbackFont?: string;
  fallbackOpacity?: number;
  imageStyle?: CSSProperties;
};

export function Avatar({
  src,
  name,
  size,
  deleted = false,
  availableNow = false,
  availableLabel,
  fallbackBackground = "var(--bg-surface-2)",
  fallbackColor = "var(--text-tertiary)",
  fallbackFont,
  fallbackOpacity,
  imageStyle,
}: AvatarProps) {
  const t = useTranslations("A11y");
  // A deleted user shows the neutral "?" glyph and never an image, even if a
  // stale src/name is still passed in.
  const initial = deleted ? "?" : initialsFromName(name);
  const showImage = !deleted && !!src;
  // "Available now" ring: photo → thin white gap → thicker accent-gradient ring.
  // Two discs sized just outside the avatar, painted BEHIND the media (which
  // sits at zIndex 1) so only their rims show; the white disc covers the
  // gradient's inner part, leaving a clean white gap between photo and gradient.
  const whiteRing = Math.max(2, Math.round(size * 0.03));
  const gradRing = Math.max(4, Math.round(size * 0.055));
  const mediaZ = { position: "relative" as const, zIndex: 1 };

  return (
    <span style={{ display: "inline-flex", flexDirection: "column", alignItems: "center", gap: "var(--space-2)" }}>
      <span style={{ position: "relative", display: "inline-flex", flexShrink: 0 }}>
        {availableNow && (
          <>
            <span
              aria-hidden="true"
              style={{
                position: "absolute",
                inset: -(whiteRing + gradRing),
                borderRadius: "50%",
                background: "linear-gradient(135deg, var(--accent), var(--accent-on-inverse))",
                pointerEvents: "none",
                zIndex: 0,
              }}
            />
            <span
              aria-hidden="true"
              style={{ position: "absolute", inset: -whiteRing, borderRadius: "50%", background: "#ffffff", pointerEvents: "none", zIndex: 0 }}
            />
          </>
        )}
        {showImage ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={src!}
            alt={t("avatarAlt", { name })}
            style={{ width: size, height: size, borderRadius: "50%", objectFit: "cover", display: "block", ...mediaZ, ...imageStyle }}
          />
        ) : (
          <span
            aria-hidden="true"
            style={{
              width: size,
              height: size,
              borderRadius: "50%",
              background: fallbackBackground,
              color: fallbackColor,
              opacity: fallbackOpacity,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              font: fallbackFont ?? `600 ${Math.round(size * 0.4)}px var(--font-display)`,
              ...mediaZ,
              ...imageStyle,
            }}
          >
            {initial}
          </span>
        )}
      </span>
      {availableNow && availableLabel && (
        <span
          style={{
            background: "var(--accent)",
            color: "var(--text-on-accent)",
            font: "var(--text-micro)",
            fontWeight: 600,
            padding: "var(--badge-padding-sm)",
            borderRadius: "var(--radius-pill)",
            whiteSpace: "nowrap",
          }}
        >
          {availableLabel}
        </span>
      )}
    </span>
  );
}
