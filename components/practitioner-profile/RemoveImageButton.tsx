"use client";

// The removal counterpart to EditPencilButton — same circular ghost
// button shape/size, but a plain "✕" and the --color-danger token (the app's
// convention for error/destructive text, e.g. the inline form error messages
// in ServicesSection.tsx) rather than the neutral pencil tone, so it doesn't
// read as just another edit action. Used wherever an image can be cleared, not
// just replaced: service thumbnails, and the profile's own avatar/banner.
export function RemoveImageButton({
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
        font: size >= 32 ? "var(--text-label)" : "var(--text-caption)",
        color: "var(--color-danger)",
        boxShadow: "var(--shadow-sm)",
        cursor: "pointer",
        padding: 0,
        flexShrink: 0,
      }}
    >
      ✕
    </button>
  );
}
