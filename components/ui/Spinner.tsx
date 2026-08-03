// A small inline loading indicator for a pending submit button — see
// DialogFormActions.tsx, the one place this is used today. currentColor
// means it automatically matches whatever text color the button it sits
// in already uses (no separate color prop to keep in sync across
// Button's primary/secondary/ghost variants). Rotation lives in the
// .spinner class in globals.css, not an inline style, so it can be
// turned off under prefers-reduced-motion.
export function Spinner({ size = 16 }: { size?: number }) {
  return (
    <svg
      aria-hidden="true"
      className="spinner"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      style={{ flexShrink: 0 }}
    >
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
      <path d="M22 12a10 10 0 0 0-10-10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}
