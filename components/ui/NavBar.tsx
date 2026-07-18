import type { ReactNode } from "react";
import { ContentContainer } from "./ContentContainer";

export type NavBarProps = {
  // Brand-agnostic by design — this slice keeps current naming, not the
  // design bundle's hardcoded "Прозрения" wordmark. The caller supplies
  // the real product name/i18n string.
  wordmark: string;
  links: string[];
  // Real content, not a plain label — the caller renders whatever's
  // appropriate (a locale-switch Link, Login/Signup buttons-as-links,
  // an auth-aware Dashboard link + sign-out form, etc.). Keeps
  // auth/navigation logic out of this shared primitive entirely.
  langToggle: ReactNode;
  actions: ReactNode;
};

// No "use client" needed — every element here is presentational; all
// real interactivity (the langToggle and actions slots) is composed in
// by the caller, which may itself render Client Components (e.g.
// Button) without NavBar needing to become one — a Server Component may
// render Client Component children freely.
export function NavBar({ wordmark, links, langToggle, actions }: NavBarProps) {
  return (
    <nav
      style={{
        padding: "20px 0",
        borderBottom: "1px solid var(--border-subtle)",
        background: "var(--bg-page)",
      }}
    >
      {/* The bar's background/border stay full-bleed on <nav> above;
          only the content row is capped at --content-max-width and
          centered — the standard "full-bleed bar, constrained content"
          split (see ContentContainer's own doc comment). */}
      <ContentContainer>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ font: "700 21px/1 var(--font-display)", color: "var(--text-primary)" }}>{wordmark}</div>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 28,
              font: "500 14px/1 var(--font-ui)",
              color: "var(--text-secondary)",
              marginLeft: 40,
            }}
          >
            {links.map((l) => (
              <span key={l}>{l}</span>
            ))}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            {langToggle}
            {actions}
          </div>
        </div>
      </ContentContainer>
    </nav>
  );
}
