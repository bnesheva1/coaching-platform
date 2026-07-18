import type { ReactNode } from "react";

export type CardTone = "surface" | "inverse";

export type CardProps = {
  eyebrow?: string;
  title?: string;
  description?: string;
  footer?: ReactNode;
  tone?: CardTone;
};

export function Card({ eyebrow, title, description, footer, tone = "surface" }: CardProps) {
  const bg = tone === "inverse" ? "var(--bg-inverse)" : "var(--bg-surface)";
  const color = tone === "inverse" ? "var(--text-on-inverse)" : "var(--text-primary)";
  return (
    <div
      style={{
        background: bg,
        color,
        border: "1px solid var(--border-subtle)",
        borderRadius: "var(--radius-xl)",
        padding: "var(--space-8)",
        boxShadow: "var(--shadow-md)",
        display: "flex",
        flexDirection: "column",
        gap: "var(--space-3)",
      }}
    >
      {eyebrow && (
        // tone="inverse" uses --accent-on-inverse, not --accent — an
        // inverse surface is effectively the opposite theme's surface,
        // so it needs the opposite theme's gold value to stay readable
        // (verified: plain --accent here fails WCAG on an inverse card,
        // 1.90:1 in dark theme — see scripts/verify-color-contrast.mjs).
        <span
          style={{
            font: "var(--text-overline)",
            letterSpacing: "var(--letter-overline)",
            textTransform: "uppercase",
            color: tone === "inverse" ? "var(--accent-on-inverse)" : "var(--accent)",
          }}
        >
          {eyebrow}
        </span>
      )}
      {title && <h3 style={{ margin: 0, font: "var(--text-heading-lg)" }}>{title}</h3>}
      {description && (
        // Ported faithfully from the design bundle: both branches of this
        // tone check resolve to the same --text-secondary value, so
        // description color does not actually change for tone="inverse".
        // Flagged as a likely authoring oversight (see the implementation
        // plan) rather than silently "fixed" here — worth a design
        // follow-up, not a unilateral call.
        <p style={{ margin: 0, font: "var(--text-body-md)", color: tone === "inverse" ? "var(--text-secondary)" : "var(--text-secondary)" }}>
          {description}
        </p>
      )}
      {footer && <div style={{ marginTop: "var(--space-3)" }}>{footer}</div>}
    </div>
  );
}
