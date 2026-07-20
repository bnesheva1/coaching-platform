"use client";

import { useState } from "react";
import type { ReactNode } from "react";
import { Link } from "@/i18n/navigation";
import { useIsMobile } from "@/lib/useIsMobile";
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
  // appropriate (a locale-switch Link, Login/Signup buttons-as-links,
  // an auth-aware Dashboard link + sign-out form, etc.). Keeps
  // auth/navigation logic out of this shared primitive entirely.
  langToggle: ReactNode;
  actions: ReactNode;
  mobileMenuLabel?: { open: string; close: string };
};

// "use client" now (previously a plain presentational Server Component)
// — collapsing `links` into a hamburger menu below 860px needs local
// open/close state and the useIsMobile hook. langToggle/actions still
// arrive as already-rendered ReactNode from the caller, which may itself
// be a Server Component — passing rendered Server Component output as
// children/props into a Client Component is standard composition and
// doesn't turn the caller itself into a Client Component.
export function NavBar({ wordmark, links, langToggle, actions, mobileMenuLabel }: NavBarProps) {
  const isMobile = useIsMobile();
  const [menuOpen, setMenuOpen] = useState(false);
  const showMenuInline = !isMobile;
  // Only worth a hamburger if at least one link is real — a menu that
  // opens to show inert placeholder text (the homepage's current
  // marketing links, not yet wired to real sections) isn't a useful
  // affordance, so it's simply not offered for that case.
  const hasRealLinks = links.some((l) => typeof l !== "string");

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
          {showMenuInline && (
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
            {actions}
            {isMobile && hasRealLinks && (
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
        </div>
        {isMobile && hasRealLinks && menuOpen && (
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: "var(--space-3)",
              padding: "var(--space-4) 0 0",
              font: "var(--text-nav)",
              color: "var(--text-secondary)",
            }}
          >
            {links.map((l) =>
              typeof l === "string" ? (
                <span key={l}>{l}</span>
              ) : (
                <Link
                  key={l.href}
                  href={l.href}
                  onClick={() => setMenuOpen(false)}
                  style={{ color: "inherit", textDecoration: "none" }}
                >
                  {l.label}
                </Link>
              ),
            )}
          </div>
        )}
      </ContentContainer>
    </nav>
  );
}
