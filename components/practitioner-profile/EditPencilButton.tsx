"use client";

// Ported from the approved design source (Practitioner Profile.dc.html's
// .pz-pencil class): a single Unicode glyph, ✎ (U+270E) — never SVG or
// emoji — in a small circular ghost button, consistently positioned
// top-right of whichever section it edits (callers position it via
// their own wrapping element; this component only owns its own look).
export function EditPencilButton({
  label,
  onClick,
  size = 26,
}: {
  label: string;
  onClick: () => void;
  size?: number;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      style={{
        width: size,
        height: size,
        borderRadius: "50%",
        background: "var(--bg-surface)",
        border: "1px solid var(--border-default)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        // Smaller than --text-icon (16px, used by the bigger sidebar/
        // toggle buttons) — these circles are themselves smaller, so a
        // proportionally smaller glyph reads better. --text-label
        // (13px) for the bigger 32px banner pencil, --text-caption
        // (12px) for the standard 26px ones — both existing tokens
        // already close to the values this used to hardcode (14/12).
        font: size >= 32 ? "var(--text-label)" : "var(--text-caption)",
        color: "var(--text-secondary)",
        boxShadow: "var(--shadow-sm)",
        cursor: "pointer",
        padding: 0,
        flexShrink: 0,
      }}
    >
      ✎
    </button>
  );
}
