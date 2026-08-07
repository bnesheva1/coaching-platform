"use client";

import { useTranslations } from "next-intl";
import { usePathname } from "@/i18n/navigation";
import { NavItem } from "@/components/dashboard/NavItem";
import { useDashboardNavigate } from "@/components/dashboard/DashboardShell";
import { Button } from "@/components/ui/Button";
import { signOut } from "@/app/actions";

// The client dashboard is bookings-only, so its inner menu is just the two
// real routes: the sessions page and settings. Past sessions and "My
// practitioners" remain sections on the sessions page itself, reached by
// scrolling — not menu links.
const NAV_ITEMS = [
  { href: "/client-dashboard", key: "clientSessions" },
  { href: "/client-dashboard/settings", key: "settings" },
] as const;

// Same shell/NavItem as the practitioner dashboard's own sidebar — this is
// the client-side counterpart.
export function ClientDashboardSidebar() {
  const t = useTranslations("Dashboard");
  const tHeader = useTranslations("Header");
  const pathname = usePathname();
  const onNavigate = useDashboardNavigate();

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", padding: "var(--space-6) var(--space-4)" }}>
      <nav style={{ display: "flex", flexDirection: "column", gap: "var(--space-1)", flex: 1 }}>
        {NAV_ITEMS.map(({ href, key }) => (
          <NavItem
            key={href}
            href={href}
            label={t(`nav.${key}`)}
            isActive={pathname === href}
            onNavigate={onNavigate}
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
