import type { CSSProperties } from "react";

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
  availableNow = false,
  availableLabel,
  fallbackBackground = "var(--accent-subtle)",
  fallbackColor = "var(--accent-subtle-text)",
  fallbackFont,
  fallbackOpacity,
  imageStyle,
}: AvatarProps) {
  const initial = (name || "?").charAt(0).toUpperCase();
  const ringGap = Math.max(3, Math.round(size * 0.045));

  return (
    <span style={{ display: "inline-flex", flexDirection: "column", alignItems: "center", gap: "var(--space-2)" }}>
      <span style={{ position: "relative", display: "inline-flex", flexShrink: 0 }}>
        {src ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={src}
            alt=""
            style={{ width: size, height: size, borderRadius: "50%", objectFit: "cover", display: "block", ...imageStyle }}
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
              ...imageStyle,
            }}
          >
            {initial}
          </span>
        )}
        {availableNow && (
          // Sibling overlay, not the image's border — sits `ringGap` outside the
          // avatar and composes with any frame the surface already applied.
          <span
            aria-hidden="true"
            style={{
              position: "absolute",
              inset: -ringGap,
              borderRadius: "50%",
              border: "3px solid var(--accent)",
              pointerEvents: "none",
            }}
          />
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
