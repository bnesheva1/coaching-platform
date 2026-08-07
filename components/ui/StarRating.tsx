import { Star } from "lucide-react";

// Rating display as filled/outline Lucide stars, replacing the old ★/☆
// text glyphs. `size` is variable per caller (the type scale around each
// usage differs); color is inherited via currentColor, so callers set the
// gold/accent tone through the parent's `color`. Decorative on its own —
// callers keep their own aria-label with the numeric rating.
export function StarRating({
  rating,
  size = 16,
  className,
}: {
  rating: number;
  size?: number;
  className?: string;
}) {
  const filled = Math.max(0, Math.min(5, Math.round(rating)));
  return (
    <span
      aria-hidden="true"
      className={className}
      style={{ display: "inline-flex", alignItems: "center", gap: 1, verticalAlign: "middle" }}
    >
      {Array.from({ length: 5 }, (_, i) => (
        <Star key={i} size={size} fill={i < filled ? "currentColor" : "none"} />
      ))}
    </span>
  );
}
