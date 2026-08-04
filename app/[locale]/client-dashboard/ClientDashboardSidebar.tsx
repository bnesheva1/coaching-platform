"use client";

import type { MouseEvent } from "react";
import { useTranslations } from "next-intl";
import { usePathname } from "@/i18n/navigation";
import { NavItem } from "@/components/dashboard/NavItem";
import { useDashboardNavigate } from "@/components/dashboard/DashboardShell";
import { Button } from "@/components/ui/Button";
import { signOut } from "@/app/actions";

// Anchor links into the ONE page below, not separate routes — unlike
// the practitioner dashboard (many distinct settings screens, a real
// fit for tabs), the client side is bookings-only today, so Past/My
// practitioners are just sections to scroll to, not destinations to
// navigate to. "Предстоящи" is the one real route link (top of the
// page); the other two are bare hashes — relative to whatever page
// they're rendered on, which is always this one, since the layout that
// mounts this sidebar has no other route left under it.
//
// expandFirst: whether clicking this item should also force-open a
// <details> at its target id before scrolling — only "Минали" needs
// this (its section starts collapsed; jumping to a collapsed accordion
// with nothing visible under the heading would be a confusing landing
// spot).
const NAV_ITEMS = [
  { href: "/client-dashboard", key: "clientUpcoming", nativeAnchor: false, expandFirst: false },
  { href: "#past", key: "clientPast", nativeAnchor: true, expandFirst: true },
  { href: "#practitioners", key: "clientPractitioners", nativeAnchor: true, expandFirst: false },
  { href: "/client-dashboard/settings", key: "settings", nativeAnchor: false, expandFirst: false },
] as const;

// Same shell/NavItem as the practitioner dashboard's own sidebar — this
// is the client-side counterpart. isActive only ever applies to
// "Предстоящи" (the only item that's a real pathname match); the two
// hash links are always plain, unhighlighted jump-links — there's no
// scroll-spy here, deliberately, to keep this simple.
export function ClientDashboardSidebar() {
  const t = useTranslations("Dashboard");
  const tHeader = useTranslations("Header");
  const pathname = usePathname();
  const onNavigate = useDashboardNavigate();

  // Drives the scroll manually rather than relying on the browser's own
  // href="#id" jump: confirmed live that a second same-page hash click
  // in a row silently fails to scroll at all (this app's Next.js
  // version doesn't reliably re-fire it) — scrollIntoView has no such
  // quirk. Also lets "Минали" force its target <details> open first, so
  // the scroll never lands on a heading with nothing visible beneath it.
  function handleSectionClick(id: string, expandFirst: boolean) {
    return (e: MouseEvent<HTMLAnchorElement>) => {
      e.preventDefault();
      const el = document.getElementById(id);
      if (!el) return;
      if (expandFirst && el instanceof HTMLDetailsElement) el.open = true;
      el.scrollIntoView({ behavior: "smooth", block: "start" });
      history.pushState(null, "", `#${id}`);
    };
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", padding: "var(--space-6) var(--space-4)" }}>
      <nav style={{ display: "flex", flexDirection: "column", gap: "var(--space-1)", flex: 1 }}>
        {NAV_ITEMS.map(({ href, key, nativeAnchor, expandFirst }) => (
          <NavItem
            key={href}
            href={href}
            label={t(`nav.${key}`)}
            isActive={pathname === href}
            onNavigate={onNavigate}
            nativeAnchor={nativeAnchor}
            onClick={nativeAnchor ? handleSectionClick(href.slice(1), expandFirst) : undefined}
          />
        ))}
      </nav>

      {/* The only place to sign out now — the header's own account menu
          was removed (just the plain "Табло" link stays there); this is
          the more familiar, expected place to look for it while already
          inside a dashboard. */}
      <form action={signOut} style={{ borderTop: "1px solid var(--border-subtle)", paddingTop: "var(--space-4)", marginTop: "var(--space-4)" }}>
        <Button variant="ghost" size="sm" type="submit">
          {tHeader("signOut")}
        </Button>
      </form>
    </div>
  );
}
