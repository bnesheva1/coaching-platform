"use client";

import { useRef, useState } from "react";
import type { ReactNode } from "react";
import { Link, usePathname } from "@/i18n/navigation";
import { useIsMobile } from "@/lib/useIsMobile";
import { useClickOutsideAndEscape } from "@/lib/useClickOutsideAndEscape";
import { Button } from "@/components/ui/Button";
import type { NavLink, AuthLink } from "@/components/ui/NavBar";
import { ChevronDown } from "lucide-react";
import styles from "./PillNav.module.css";

// A mega-menu link carries an optional one-line description (rendered under the
// bold label in the panel + drawer). Same href/label as the plain nav links.
export type MegaMenuLink = NavLink & { description?: string };

// Same structured props as NavBar (SiteHeader passes them identically) — this is
// the brand-three floating-pill presentation of that same data, not new nav.
export type PillNavProps = {
  wordmark: string;
  navLabel: string;
  browseLink: NavLink;
  infoDropdownLabel: string;
  infoLinks: MegaMenuLink[];
  dashboardLink: NavLink | null;
  greetingText: string | null;
  accountLinks: NavLink[] | null;
  signOut: { label: string; action: () => void | Promise<void> } | null;
  authLinks: AuthLink[] | null;
  langToggle?: ReactNode;
  themeToggle?: ReactNode;
  mobileMenuLabel?: { open: string; close: string };
};

export function PillNav({
  wordmark,
  navLabel,
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
}: PillNavProps) {
  const isMobile = useIsMobile();
  // Exactly one desktop menu open at a time — opening one closes the other
  // ("closes when another nav item is activated"). Escape / outside-click also
  // clear it (via the hook below).
  const [openMenu, setOpenMenu] = useState<null | "info" | "account">(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const barRef = useRef<HTMLDivElement>(null);
  const navRef = useRef<HTMLElement>(null);
  const pathname = usePathname();
  const isCurrent = (href: string) => pathname === href || pathname.startsWith(`${href}/`);

  useClickOutsideAndEscape(barRef, !isMobile && openMenu !== null, () => setOpenMenu(null));
  useClickOutsideAndEscape(navRef, isMobile && drawerOpen, () => setDrawerOpen(false));

  return (
    <nav ref={navRef} aria-label={navLabel} className={styles.wrap}>
      {/* While the mega-menu is open, blur the whole page behind the (sharp)
          header + panel. Clicking it closes the menu (outside-click also does). */}
      {!isMobile && openMenu === "info" && (
        <div className={styles.blurBackdrop} aria-hidden="true" onClick={() => setOpenMenu(null)} />
      )}
      <div ref={barRef} className={`${styles.bar} ${openMenu ? styles.barMenuOpen : ""}`}>
        {/* Far left — wordmark doubles as the home link (site-wide convention). */}
        <Link href="/" className={styles.logo}>
          {wordmark}
        </Link>

        {/* Centre — primary nav. Order matches NavBar: dashboard → browse → info. */}
        {!isMobile && (
          <div className={styles.center}>
            {dashboardLink && (
              <Link href={dashboardLink.href} aria-current={isCurrent(dashboardLink.href) ? "page" : undefined} className={styles.navLink}>
                {dashboardLink.label}
              </Link>
            )}
            <Link href={browseLink.href} aria-current={isCurrent(browseLink.href) ? "page" : undefined} className={styles.navLink}>
              {browseLink.label}
            </Link>
            <button
              type="button"
              className={`focus-ring ${styles.trigger} ${openMenu === "info" ? styles.triggerOpen : ""}`}
              aria-expanded={openMenu === "info"}
              aria-haspopup="true"
              onClick={() => setOpenMenu((m) => (m === "info" ? null : "info"))}
            >
              {infoDropdownLabel}
              <ChevronDown size={15} aria-hidden="true" className={`${styles.chevron} ${openMenu === "info" ? styles.chevronOpen : ""}`} />
            </button>
          </div>
        )}

        {/* Far right — account menu (signed in) OR login + solid-pill CTA (signed
            out), then the lang/theme toggles. */}
        {!isMobile && (
          <div className={styles.actions}>
            {greetingText && accountLinks && signOut && (
              <div className={styles.accountWrap}>
                <button
                  type="button"
                  className={`focus-ring ${styles.trigger} ${openMenu === "account" ? styles.triggerOpen : ""}`}
                  aria-expanded={openMenu === "account"}
                  aria-haspopup="true"
                  onClick={() => setOpenMenu((m) => (m === "account" ? null : "account"))}
                >
                  {greetingText}
                  <ChevronDown size={15} aria-hidden="true" className={`${styles.chevron} ${openMenu === "account" ? styles.chevronOpen : ""}`} />
                </button>
                {openMenu === "account" && (
                  <div className={styles.accountPanel} role="menu">
                    {accountLinks.map((l) => (
                      <Link key={l.href} href={l.href} role="menuitem" className={styles.accountItem} onClick={() => setOpenMenu(null)}>
                        {l.label}
                      </Link>
                    ))}
                    {/* No onClick close: setOpenMenu(null) would unmount this form
                        before the action dispatches. The action redirects, so the
                        menu never needs manual closing. */}
                    <form action={signOut.action} className={styles.signoutForm}>
                      <button type="submit" className={styles.accountItem} role="menuitem">
                        {signOut.label}
                      </button>
                    </form>
                  </div>
                )}
              </div>
            )}
            {authLinks?.map((l) =>
              l.variant === "primary" ? (
                <Button key={l.href} variant="primary" size="sm" href={l.href}>
                  {l.label}
                </Button>
              ) : (
                <Link key={l.href} href={l.href} className={styles.loginLink}>
                  {l.label}
                </Link>
              ),
            )}
            {langToggle}
            {themeToggle}
          </div>
        )}

        {/* Mobile — the pill collapses to logo + hamburger. */}
        {isMobile && (
          <button
            type="button"
            className={styles.mobileBtn}
            aria-label={drawerOpen ? mobileMenuLabel?.close : mobileMenuLabel?.open}
            aria-expanded={drawerOpen}
            onClick={() => setDrawerOpen((o) => !o)}
          >
            {drawerOpen ? "✕" : "☰"}
          </button>
        )}

        {/* Mega-menu panel — same frosted/rounded treatment as the bar, dropped
            directly below it. Adaptive: only the middle links column has content
            today; the left intro/CTA column and right feature card are omitted
            (see PillNav.module.css .panelGrid) until real content exists — the
            grid + markup accept them without restructuring. */}
        {!isMobile && openMenu === "info" && (
          <div className={styles.panel} role="region" aria-label={infoDropdownLabel}>
            <div className={styles.panelGrid}>
              <div className={styles.linksCol}>
                {infoLinks.map((l) => (
                  <Link key={l.href} href={l.href} className={styles.megaLink} onClick={() => setOpenMenu(null)}>
                    <span className={styles.megaLabel}>{l.label}</span>
                    {l.description && <span className={styles.megaDesc}>{l.description}</span>}
                  </Link>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Mobile drawer — flat list (dashboard → browse → info links w/ their
          descriptions → toggles → auth/account). No mega panel on phones. */}
      {isMobile && (
        <div className={`${styles.drawer} ${drawerOpen ? styles.drawerOpen : ""}`} inert={!drawerOpen}>
          <div className={styles.drawerInner}>
            {dashboardLink && (
              <Link href={dashboardLink.href} onClick={() => setDrawerOpen(false)} className={styles.drawerPrimaryLink}>
                {dashboardLink.label}
              </Link>
            )}
            <Link href={browseLink.href} onClick={() => setDrawerOpen(false)} className={styles.drawerPrimaryLink}>
              {browseLink.label}
            </Link>
            {infoLinks.map((l) => (
              <Link key={l.href} href={l.href} onClick={() => setDrawerOpen(false)} className={styles.drawerLink}>
                <span className={styles.megaLabel}>{l.label}</span>
                {l.description && <span className={styles.megaDesc}>{l.description}</span>}
              </Link>
            ))}

            {(langToggle || themeToggle) && (
              <div className={styles.drawerCluster} style={{ flexDirection: "row", alignItems: "center", gap: "var(--space-3)" }}>
                {langToggle}
                {themeToggle}
              </div>
            )}

            {authLinks && (
              <div className={styles.drawerCluster} onClick={() => setDrawerOpen(false)}>
                {authLinks.map((l) => (
                  <Button key={l.href} variant={l.variant} size="sm" href={l.href}>
                    {l.label}
                  </Button>
                ))}
              </div>
            )}

            {accountLinks && signOut && (
              <div className={styles.drawerCluster}>
                {accountLinks.map((l) => (
                  <Link key={l.href} href={l.href} onClick={() => setDrawerOpen(false)} className={styles.drawerLink} style={{ color: "var(--text-secondary)" }}>
                    {l.label}
                  </Link>
                ))}
                <form action={signOut.action} style={{ margin: 0 }}>
                  <button type="submit" className={styles.accountItem} style={{ color: "var(--text-secondary)", padding: "var(--space-2) 0" }}>
                    {signOut.label}
                  </button>
                </form>
              </div>
            )}
          </div>
        </div>
      )}

      {isMobile && drawerOpen && <div className={styles.scrim} onClick={() => setDrawerOpen(false)} />}
    </nav>
  );
}
