import type { ReactNode } from "react";

// The single reusable wrapper for page/content width — every page (and
// primitive, e.g. NavBar) uses this instead of hardcoding its own
// maxWidth. Bounds CONTENT only: a section's background/fill stays
// full-bleed on its own outer element, wrapping only what sits on top
// of it in this container, never the background itself.
export function ContentContainer({ children }: { children: ReactNode }) {
  return (
    <div style={{ maxWidth: "var(--content-max-width)", margin: "0 auto", padding: "0 var(--space-6)" }}>
      {children}
    </div>
  );
}
