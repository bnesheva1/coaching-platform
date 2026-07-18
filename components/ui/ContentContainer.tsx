import type { ReactNode } from "react";

// The single reusable wrapper for page/content width — every page (and
// primitive, e.g. NavBar) uses this instead of hardcoding its own
// maxWidth. Bounds CONTENT only: a section's background/fill stays
// full-bleed on its own outer element, wrapping only what sits on top
// of it in this container, never the background itself.
//
// maxWidth is an optional override, not a second source of truth: a
// narrow form/reading column (e.g. a login form, a dashboard) is a
// genuinely different, deliberate choice from the site's general
// --content-max-width (used for chrome-level layout like NavBar and
// the homepage), not a hardcoded escape from the token system — the
// page still goes through this one component either way.
export function ContentContainer({ children, maxWidth }: { children: ReactNode; maxWidth?: number | string }) {
  return (
    <div style={{ maxWidth: maxWidth ?? "var(--content-max-width)", margin: "0 auto", padding: "0 var(--space-6)" }}>
      {children}
    </div>
  );
}
