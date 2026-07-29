"use client";

import { useTranslations } from "next-intl";
import { usePathname } from "@/i18n/navigation";
import { NavItem } from "@/components/dashboard/NavItem";
import { useDashboardNavigate } from "@/components/dashboard/DashboardShell";

const NAV_ITEMS = [
  { href: "/client-dashboard", key: "clientUpcoming" },
  { href: "/client-dashboard/past", key: "clientPast" },
  { href: "/client-dashboard/practitioners", key: "clientPractitioners" },
] as const;

// Same shell/NavItem as the practitioner dashboard's own sidebar — this
// is the client-side counterpart, three sections instead of six tabs,
// and no pulse widget at the bottom (there's no client equivalent of
// "sessions this week" worth surfacing there today).
export function ClientDashboardSidebar() {
  const t = useTranslations("Dashboard");
  const pathname = usePathname();
  const onNavigate = useDashboardNavigate();

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", padding: "var(--space-6) var(--space-4)" }}>
      <nav style={{ display: "flex", flexDirection: "column", gap: "var(--space-1)", flex: 1 }}>
        {NAV_ITEMS.map(({ href, key }) => (
          <NavItem key={href} href={href} label={t(`nav.${key}`)} isActive={pathname === href} onNavigate={onNavigate} />
        ))}
      </nav>
    </div>
  );
}
