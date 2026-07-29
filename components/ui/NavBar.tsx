"use client";

import { useRef, useState } from "react";
import type { ReactNode } from "react";
import { Link } from "@/i18n/navigation";
import { useIsMobile } from "@/lib/useIsMobile";
import { useClickOutsideAndEscape } from "@/lib/useClickOutsideAndEscape";
import { ContentContainer } from "./ContentContainer";

// A plain string keeps the original, not-yet-real homepage links (marketing
// sections with no route yet) rendering exactly as before — a mode this
// component still supports rather than forcing every existing caller to
// invent a destination. A {label, href} entry is a real, clickable,
// locale-aware Link, used wherever a genuine destination already exists.
export type NavLink = string | { label: string; href: string };

export type NavBarProps = {
  // Brand-agnostic by design — this slice keeps current naming, not the
  // design bundle's hardcoded "Прозрения" wordmark. The caller supplies
  // the real product name/i18n string. Doubles as the home link now
  // (see the doc comment below on why there's no separate text link
  // for it).
  wordmark: string;
  links: NavLink[];
  // Real content, not a plain label — the caller renders whatever's
  // appropriate (a locale-switch control, Login/Signup buttons-as-
  // links, a Dashboard link + account menu, etc.). Keeps auth/
  // navigation/theme logic out of this shared primitive entirely.
  langToggle: ReactNode;
  themeToggle?: ReactNode;
  actions: ReactNode;
  mobileMenuLabel?: { open: string; close: string };
};

// "use client" — collapsing everything but the wordmark into a mobile
// menu needs local open/close state and the useIsMobile hook.
// langToggle/themeToggle/actions still arrive as already-rendered
// ReactNode from the caller, which may itself be a Server Component —
// passing rendered Server Component output as children/props into a
// Client Component is standard composition and doesn't turn the caller
// itself into a Client Component.
//
// Mobile layout is a deliberate departure from "shrink everything into
// the top row": the top bar stays down to just the wordmark and the
// menu toggle, and EVERYTHING else (nav links, language toggle, theme
// toggle, account actions) lives in one polished dropdown panel below
// it — a client-facing, mostly-mobile surface deserves a real menu, not
// a cramped row of icon buttons squeezed in next to the hamburger.
export function NavBar({ wordmark, links, langToggle, themeToggle, actions, mobileMenuLabel }: NavBarProps) {
  const isMobile = useIsMobile();
  const [menuOpen, setMenuOpen] = useState(false);
  const navRef = useRef<HTMLElement>(null);
  const hasRealLinks = links.some((l) => typeof l !== "string");

  useClickOutsideAndEscape(navRef, isMobile && menuOpen, () => setMenuOpen(false));

  return (
    <nav
      ref={navRef}
      style={{
        position: "relative",
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
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            {/* The wordmark is the home link, rather than a separate
                "Home" text entry in `links` — on the practitioner
                dashboard, the sidebar already has its own "Начало"
                (home) tab for the dashboard's own home screen; a
                second, differently-scoped link in the top bar with the
                same label would read as the same destination when it
                isn't. Making the logo itself the home link (a standard,
                unambiguous convention) avoids that collision. */}
            <Link
              href="/"
              style={{
                font: "var(--text-wordmark)",
                color: "var(--text-primary)",
                textDecoration: "none",
              }}
            >
              {wordmark}
            </Link>
          </div>

          {!isMobile && (
            <>
              {hasRealLinks && (
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 28,
                    font: "var(--text-nav)",
                    color: "var(--text-secondary)",
                    marginLeft: 40,
                  }}
                >
                  {links.map((l) =>
                    typeof l === "string" ? (
                      <span key={l}>{l}</span>
                    ) : (
                      <Link key={l.href} href={l.href} style={{ color: "inherit", textDecoration: "none" }}>
                        {l.label}
                      </Link>
                    ),
                  )}
                </div>
              )}
              <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                {langToggle}
                {themeToggle}
                {actions}
              </div>
            </>
          )}

          {isMobile && (
            <button
              type="button"
              aria-label={menuOpen ? mobileMenuLabel?.close : mobileMenuLabel?.open}
              aria-expanded={menuOpen}
              onClick={() => setMenuOpen((open) => !open)}
              style={{
                background: "transparent",
                border: "1px solid var(--border-strong)",
                borderRadius: "var(--radius-sm)",
                color: "var(--text-primary)",
                font: "var(--text-icon)",
                padding: "6px 10px",
                cursor: "pointer",
              }}
            >
              {menuOpen ? "✕" : "☰"}
            </button>
          )}
        </div>
      </ContentContainer>

      {/* A real off-canvas drawer — same pattern as DashboardShell's
          mobile sidebar (fixed, full height, left-anchored, width-
          animated, --shadow-lg over a dimmed --overlay-scrim) — not a
          dropdown card. Always mounted once mobile (width animates
          0 → open), so it slides rather than just appearing; the scrim
          itself stays conditionally rendered, same as DashboardShell's. */}
      {isMobile && (
        <div
          style={{
            position: "fixed",
            top: 0,
            bottom: 0,
            left: 0,
            width: menuOpen ? "min(260px, 80vw)" : 0,
            overflow: "hidden",
            transition: "width var(--duration-base) var(--ease-standard)",
            background: "var(--bg-surface)",
            boxShadow: menuOpen ? "var(--shadow-lg)" : "none",
            zIndex: 41,
          }}
        >
          <div
            style={{
              width: "min(260px, 80vw)",
              height: "100%",
              display: "flex",
              flexDirection: "column",
              padding: "var(--space-6) var(--space-5)",
              overflowY: "auto",
            }}
          >
            {hasRealLinks && (
              <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-1)" }}>
                {links.map((l) =>
                  typeof l === "string" ? (
                    <span key={l} style={{ font: "var(--text-nav)", color: "var(--text-secondary)", padding: "var(--space-2) 0" }}>
                      {l}
                    </span>
                  ) : (
                    <Link
                      key={l.href}
                      href={l.href}
                      onClick={() => setMenuOpen(false)}
                      style={{
                        font: "var(--text-nav)",
                        fontWeight: 600,
                        color: "var(--text-primary)",
                        textDecoration: "none",
                        padding: "var(--space-2) 0",
                      }}
                    >
                      {l.label}
                    </Link>
                  ),
                )}
              </div>
            )}

            {/* Login/Register, or Табло + account menu — right under the
                nav links, not tucked at the very end. */}
            <div style={{ marginTop: "var(--space-5)", display: "flex", flexDirection: "column", gap: "var(--space-2)", alignItems: "flex-start" }}>
              {actions}
            </div>

            {/* Settings (language, theme) pinned to the bottom of the
                drawer via marginTop: auto — the least-frequently-needed
                controls, out of the way of the actual navigation above. */}
            <div
              style={{
                marginTop: "auto",
                paddingTop: "var(--space-5)",
                borderTop: "1px solid var(--border-subtle)",
                display: "flex",
                alignItems: "center",
                gap: "var(--space-3)",
              }}
            >
              {langToggle}
              {themeToggle}
            </div>
          </div>
        </div>
      )}

      {isMobile && menuOpen && (
        <div
          onClick={() => setMenuOpen(false)}
          style={{
            position: "fixed",
            inset: 0,
            background: "var(--overlay-scrim)",
            zIndex: 40,
          }}
        />
      )}
    </nav>
  );
}
