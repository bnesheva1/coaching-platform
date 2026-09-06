"use client";

import { useTranslations } from "next-intl";
import { usePathname } from "@/i18n/navigation";
import { NavItem } from "@/components/dashboard/NavItem";
import { useDashboardNavigate } from "@/components/dashboard/DashboardShell";
import { Button } from "@/components/ui/Button";
import { signOut } from "@/app/actions";
import { House, CalendarDays, CircleUser, Sparkles, Clock, ChartColumn, Star, Settings, type LucideIcon } from "lucide-react";

export type DashboardPulse = {
  sessionCount: number;
  totalUpcoming: number;
};

type NavEntry = { href: string; key: string; Icon?: LucideIcon };

const NAV_ITEMS: NavEntry[] = [
  { href: "/practitioner-dashboard", key: "home" },
  { href: "/practitioner-dashboard/stats", key: "stats" },
  { href: "/practitioner-dashboard/profile", key: "profile" },
  { href: "/practitioner-dashboard/services", key: "services" },
  { href: "/practitioner-dashboard/schedule", key: "schedule" },
  { href: "/practitioner-dashboard/bookings", key: "bookings" },
  { href: "/practitioner-dashboard/reviews", key: "reviews" },
  { href: "/practitioner-dashboard/settings", key: "settings" },
];

// Brand two: reordered (Начало, Сесии, Профил, Услуги, График, Статистика,
// Отзиви, Настройки) with a leading Lucide icon per item.
const NAV_ITEMS_TWO: NavEntry[] = [
  { href: "/practitioner-dashboard", key: "home", Icon: House },
  { href: "/practitioner-dashboard/bookings", key: "bookings", Icon: CalendarDays },
  { href: "/practitioner-dashboard/profile", key: "profile", Icon: CircleUser },
  { href: "/practitioner-dashboard/services", key: "services", Icon: Sparkles },
  { href: "/practitioner-dashboard/schedule", key: "schedule", Icon: Clock },
  { href: "/practitioner-dashboard/stats", key: "stats", Icon: ChartColumn },
  { href: "/practitioner-dashboard/reviews", key: "reviews", Icon: Star },
  { href: "/practitioner-dashboard/settings", key: "settings", Icon: Settings },
];

// No wordmark here — that lives in the top NavBar now, and repeating it
// in the drawer would mean the same word ("Начало"/Home) pointing at two
// different destinations on one screen (see NavBar.tsx's own comment on
// this). Sidebar owns only the dashboard's internal tabs.
export function DashboardSidebar({ pulse, isBrandTwo = false }: { pulse: DashboardPulse; isBrandTwo?: boolean }) {
  const t = useTranslations("Dashboard");
  const tHeader = useTranslations("Header");
  const pathname = usePathname();
  const onNavigate = useDashboardNavigate();

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", padding: "var(--space-6) var(--space-4)" }}>
      <nav aria-label={tHeader("navDashboardLabel")} style={{ display: "flex", flexDirection: "column", gap: "var(--space-1)", flex: 1 }}>
        {(isBrandTwo ? NAV_ITEMS_TWO : NAV_ITEMS).map(({ href, key, Icon }) => (
          <NavItem
            key={href}
            href={href}
            label={t(`nav.${key}`)}
            isActive={pathname === href}
            onNavigate={onNavigate}
            icon={Icon ? <Icon size={18} strokeWidth={1.8} /> : undefined}
          />
        ))}
      </nav>

      <div
        style={{
          borderTop: "1px solid var(--border-subtle)",
          paddingTop: "var(--space-4)",
          marginTop: "var(--space-4)",
        }}
      >
        <p style={{ margin: 0, font: "var(--text-overline)", letterSpacing: "var(--letter-overline)", textTransform: "uppercase", color: "var(--text-tertiary)" }}>
          {t("pulseThisWeek")}
        </p>
        <p style={{ margin: "var(--space-1) 0 0", font: "var(--text-heading-sm)" }}>
          {t("pulseSessions", { count: pulse.sessionCount })}
        </p>
        <p style={{ margin: "var(--space-1) 0 0", font: "var(--text-body-sm)", color: "var(--text-tertiary)" }}>
          {t("pulseUpcomingTotal", { count: pulse.totalUpcoming })}
        </p>
      </div>

      {/* The only place to sign out now — the header's own account menu
          was removed (just the plain "Табло" link stays there); this is
          the more familiar, expected place to look for it while already
          inside a dashboard. */}
      <form action={signOut} style={{ marginTop: "var(--space-4)" }}>
        <Button variant="ghost" size="sm" type="submit">
          {tHeader("signOut")}
        </Button>
      </form>
    </div>
  );
}
