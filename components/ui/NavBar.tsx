"use client";

import { useRef, useState } from "react";
import type { ReactNode } from "react";
import { Link } from "@/i18n/navigation";
import { useIsMobile } from "@/lib/useIsMobile";
import { useClickOutsideAndEscape } from "@/lib/useClickOutsideAndEscape";
import { Button } from "./Button";
import { ContentContainer } from "./ContentContainer";

export type NavLink = { label: string; href: string };
export type AuthLink = NavLink & { variant: "ghost" | "primary" };

export type NavBarProps = {
  wordmark: string;
  browseLink: NavLink;
  // "Информация"/"Info" — the desktop dropdown trigger label. Its
  // contents (infoLinks) are the same 5 marketing pages regardless of
  // viewer role; only browseLink/dashboardLink/authLinks vary by role.
  infoDropdownLabel: string;
  infoLinks: NavLink[];
  // Signed-in state. Mutually exclusive with authLinks — exactly one of
  // the two is non-null for any given viewer. label is the plain
  // "Табло"/"Dashboard" text: used verbatim as mobile's flat list item,
  // and as desktop's tooltip/aria-label on the greeting link (whose
  // VISIBLE text is greetingText instead — two different strings for
  // the same destination, which is why both travel separately rather
  // than one prop trying to serve both layouts).
  dashboardLink: NavLink | null;
  // "Привет, {name}" — the account-menu trigger's visible text (desktop) and
  // the identity it shows. Null exactly when dashboardLink is null.
  greetingText: string | null;
  // Account-menu contents (Настройки, and Моят профил for practitioners) —
  // account-level links only, never content navigation. Null when signed out.
  accountLinks: NavLink[] | null;
  // Sign-out lives in the account menu (desktop) and the mobile drawer's
  // bottom cluster. A server action passed straight through to a <form>.
  // Null when signed out.
  signOut: { label: string; action: () => void | Promise<void> } | null;
  // Login (ghost) + Register (primary), null when signed in.
  authLinks: AuthLink[] | null;
  // Both optional and rendered independently — dropping either one (or
  // both) from what the caller passes is the whole removal mechanism;
  // nothing else in this component needs to change.
  langToggle?: ReactNode;
  themeToggle?: ReactNode;
  mobileMenuLabel?: { open: string; close: string };
};

const navLinkStyle = {
  color: "inherit",
  textDecoration: "none",
  font: "var(--text-nav)",
} as const;

const dropdownItemStyle = {
  display: "block",
  padding: "var(--space-2) var(--space-3)",
  borderRadius: "var(--radius-sm)",
  color: "var(--text-primary)",
  textDecoration: "none",
  font: "var(--text-nav)",
  whiteSpace: "nowrap",
} as const;

// The desktop "Информация" dropdown — a plain absolute-positioned panel
// under its trigger, same weight/pattern as SlotPicker's jump-to-date
// popover elsewhere in this app (not a full ARIA menu widget with
// roving tabindex/arrow-key navigation — nothing else in this app goes
// that far for a handful of static links, and this is desktop-only).
function InfoDropdown({ label, links }: { label: string; links: NavLink[] }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useClickOutsideAndEscape(ref, open, () => setOpen(false));

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button
        type="button"
        className="focus-ring nav-menu-trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 4,
          background: "none",
          border: "none",
          padding: 0,
          cursor: "pointer",
          color: "inherit",
          font: "var(--text-nav)",
        }}
      >
        {label}
        <span aria-hidden="true" style={{ fontSize: "10px", transform: open ? "rotate(180deg)" : "none" }}>
          ▾
        </span>
      </button>
      {open && (
        <div
          role="menu"
          style={{
            position: "absolute",
            top: "calc(100% + var(--space-2))",
            left: 0,
            minWidth: 200,
            background: "var(--bg-surface)",
            border: "1px solid var(--border-subtle)",
            borderRadius: "var(--radius-md)",
            boxShadow: "var(--shadow-md)",
            padding: "var(--space-2)",
            zIndex: 45,
          }}
        >
          {links.map((l) => (
            <Link key={l.href} href={l.href} role="menuitem" onClick={() => setOpen(false)} className="nav-menu-item" style={dropdownItemStyle}>
              {l.label}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

// The signed-in account menu — the greeting turned into a real dropdown,
// same mechanism as InfoDropdown (button + chevron + aria-haspopup/expanded,
// role="menu"/menuitem, click-outside/Escape). Account-level only: the links
// the caller passes, then Sign out via a <form> so it stays a real POST to
// the server action, not a client-side navigation. Anchored to the right
// edge since it lives in the far-right cluster.
function AccountMenu({
  greeting,
  links,
  signOut,
}: {
  greeting: string;
  links: NavLink[];
  signOut: { label: string; action: () => void | Promise<void> };
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useClickOutsideAndEscape(ref, open, () => setOpen(false));

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button
        type="button"
        className="focus-ring nav-menu-trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 4,
          background: "none",
          border: "none",
          padding: 0,
          cursor: "pointer",
          color: "var(--text-primary)",
          font: "var(--text-nav)",
        }}
      >
        {greeting}
        <span aria-hidden="true" style={{ fontSize: "10px", transform: open ? "rotate(180deg)" : "none" }}>
          ▾
        </span>
      </button>
      {open && (
        <div
          role="menu"
          style={{
            position: "absolute",
            top: "calc(100% + var(--space-2))",
            right: 0,
            minWidth: 200,
            background: "var(--bg-surface)",
            border: "1px solid var(--border-subtle)",
            borderRadius: "var(--radius-md)",
            boxShadow: "var(--shadow-md)",
            padding: "var(--space-2)",
            zIndex: 45,
          }}
        >
          {links.map((l) => (
            <Link key={l.href} href={l.href} role="menuitem" onClick={() => setOpen(false)} className="nav-menu-item" style={dropdownItemStyle}>
              {l.label}
            </Link>
          ))}
          {/* No onClick to close the menu here: setOpen(false) unmounts this
              form ({open && …}) before the server action dispatches, silently
              cancelling sign-out. The action redirects to /login, so the menu
              never needs closing — the page navigates away. */}
          <form action={signOut.action} style={{ margin: 0, marginTop: "var(--space-1)", paddingTop: "var(--space-1)", borderTop: "1px solid var(--border-subtle)" }}>
            <button
              type="submit"
              role="menuitem"
              className="nav-menu-item"
              style={{ ...dropdownItemStyle, width: "100%", textAlign: "left", background: "none", border: "none", cursor: "pointer" }}
            >
              {signOut.label}
            </button>
          </form>
        </div>
      )}
    </div>
  );
}

// "use client" — the mobile drawer needs local open/close state and
// useIsMobile; the desktop info dropdown needs its own local state too.
// langToggle/themeToggle arrive as already-rendered ReactNode from the
// caller (possibly itself a Server Component) — standard composition,
// doesn't turn the caller into a Client Component.
export function NavBar({
  wordmark,
  browseLink,
  infoDropdownLabel,
  infoLinks,
  dashboardLink,
  greetingText,
  accountLinks,
  signOut,
  authLinks,
  langToggle,
  themeToggle,
  mobileMenuLabel,
}: NavBarProps) {
  const isMobile = useIsMobile();
  const [menuOpen, setMenuOpen] = useState(false);
  const navRef = useRef<HTMLElement>(null);

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
      <ContentContainer>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          {/* Far left — the wordmark doubles as the home link (see the
              site-wide convention: no separate "Home" nav entry). */}
          <Link
            href="/"
            style={{ font: "var(--text-wordmark)", color: "var(--text-primary)", textDecoration: "none" }}
          >
            {wordmark}
          </Link>

          {!isMobile && (
            <>
              {/* Center-left, in order: their own area first (the primary
                  destination — rendered in primary text so it leads), then
                  browse, then the info dropdown. */}
              <div style={{ display: "flex", alignItems: "center", gap: 28, color: "var(--text-secondary)", marginLeft: 40 }}>
                {dashboardLink && (
                  <Link href={dashboardLink.href} className="nav-menu-trigger" style={{ ...navLinkStyle, color: "var(--text-primary)" }}>
                    {dashboardLink.label}
                  </Link>
                )}
                <Link href={browseLink.href} style={navLinkStyle}>
                  {browseLink.label}
                </Link>
                <InfoDropdown label={infoDropdownLabel} links={infoLinks} />
              </div>

              {/* Far right: the account menu (or the login/register
                  buttons), then lang + theme. The visible link to their own
                  area now leads the left nav group above. */}
              <div style={{ display: "flex", alignItems: "center", gap: 14, marginLeft: "auto" }}>
                {greetingText && accountLinks && signOut && (
                  <AccountMenu greeting={greetingText} links={accountLinks} signOut={signOut} />
                )}
                {authLinks?.map((l) => (
                  <Button key={l.href} variant={l.variant} size="sm" href={l.href}>
                    {l.label}
                  </Button>
                ))}
                {langToggle}
                {themeToggle}
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

      {/* A real off-canvas drawer, anchored to the RIGHT edge and slid in
          with a transform (translateX 100% → 0) so it enters and leaves
          from the right. Always mounted once mobile; `inert` when closed
          keeps its off-screen links out of the tab order and untouchable. */}
      {isMobile && (
        <div
          inert={!menuOpen}
          style={{
            position: "fixed",
            top: 0,
            bottom: 0,
            right: 0,
            width: "min(260px, 80vw)",
            overflow: "hidden",
            transform: menuOpen ? "translateX(0)" : "translateX(100%)",
            transition: "transform var(--duration-base) var(--ease-standard)",
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
              gap: "var(--space-1)",
            }}
          >
            {/* Flat list, no dropdown — the hamburger IS the
                consolidation on mobile. Exact order: dashboard (if
                signed in) → browse → the 5 info links → lang → theme →
                auth links (if signed out). */}
            {dashboardLink && (
              <Link
                href={dashboardLink.href}
                onClick={() => setMenuOpen(false)}
                style={{ font: "var(--text-nav)", fontWeight: 600, color: "var(--text-primary)", textDecoration: "none", padding: "var(--space-2) 0" }}
              >
                {dashboardLink.label}
              </Link>
            )}
            <Link
              href={browseLink.href}
              onClick={() => setMenuOpen(false)}
              style={{ font: "var(--text-nav)", fontWeight: 600, color: "var(--text-primary)", textDecoration: "none", padding: "var(--space-2) 0" }}
            >
              {browseLink.label}
            </Link>
            {infoLinks.map((l) => (
              <Link
                key={l.href}
                href={l.href}
                onClick={() => setMenuOpen(false)}
                style={{ font: "var(--text-nav)", color: "var(--text-secondary)", textDecoration: "none", padding: "var(--space-2) 0" }}
              >
                {l.label}
              </Link>
            ))}

            {(langToggle || themeToggle) && (
              <div
                style={{
                  marginTop: "var(--space-4)",
                  paddingTop: "var(--space-4)",
                  borderTop: "1px solid var(--border-subtle)",
                  display: "flex",
                  alignItems: "center",
                  gap: "var(--space-3)",
                }}
              >
                {langToggle}
                {themeToggle}
              </div>
            )}

            {authLinks && (
              // onClick on the wrapper (not each Button individually):
              // Buttons arrive as opaque pre-rendered content, no way to
              // wire a per-item close — any click here means real
              // navigation is about to happen, so close the drawer.
              <div
                onClick={() => setMenuOpen(false)}
                style={{ marginTop: "var(--space-4)", display: "flex", flexDirection: "column", gap: "var(--space-2)", alignItems: "flex-start" }}
              >
                {authLinks.map((l) => (
                  <Button key={l.href} variant={l.variant} size="sm" href={l.href}>
                    {l.label}
                  </Button>
                ))}
              </div>
            )}

            {/* Signed-in account cluster — Моят профил (practitioner) /
                Настройки, then Изход — at the bottom by the toggles, no
                dropdown (the hamburger is the consolidation). */}
            {accountLinks && signOut && (
              <div style={{ marginTop: "var(--space-4)", display: "flex", flexDirection: "column", gap: "var(--space-1)", alignItems: "flex-start" }}>
                {accountLinks.map((l) => (
                  <Link
                    key={l.href}
                    href={l.href}
                    onClick={() => setMenuOpen(false)}
                    style={{ font: "var(--text-nav)", color: "var(--text-secondary)", textDecoration: "none", padding: "var(--space-2) 0" }}
                  >
                    {l.label}
                  </Link>
                ))}
                {/* No onSubmit to close the drawer: the action redirects to
                    /login, so the drawer never needs closing, and closing it
                    (inert) mid-submit could interfere with the in-flight
                    server action. */}
                <form action={signOut.action} style={{ margin: 0 }}>
                  <button
                    type="submit"
                    style={{ font: "var(--text-nav)", color: "var(--text-secondary)", background: "none", border: "none", padding: "var(--space-2) 0", cursor: "pointer", textAlign: "left" }}
                  >
                    {signOut.label}
                  </button>
                </form>
              </div>
            )}
          </div>
        </div>
      )}

      {isMobile && menuOpen && (
        <div
          onClick={() => setMenuOpen(false)}
          style={{ position: "fixed", inset: 0, background: "var(--overlay-scrim)", zIndex: 40 }}
        />
      )}
    </nav>
  );
}
