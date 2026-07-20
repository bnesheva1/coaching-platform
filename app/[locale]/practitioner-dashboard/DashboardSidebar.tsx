"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Link, usePathname } from "@/i18n/navigation";

export type DashboardPulse = {
  sessionCount: number;
  totalUpcoming: number;
};

const NAV_ITEMS = [
  { href: "/practitioner-dashboard", key: "home" },
  { href: "/practitioner-dashboard/profile", key: "profile" },
  { href: "/practitioner-dashboard/services", key: "services" },
  { href: "/practitioner-dashboard/schedule", key: "schedule" },
  { href: "/practitioner-dashboard/bookings", key: "bookings" },
  { href: "/practitioner-dashboard/reviews", key: "reviews" },
] as const;

// Colors/shape ported directly from the approved design source
// (Practitioner Dashboard.dc.html's .om-navitem class + its per-item
// active/inactive style computation): active is a soft accent-tinted
// pill (--accent-subtle bg + --accent-subtle-text, not a solid gold
// fill), inactive is plain --text-secondary with a --bg-surface-2 hover
// — not something inline styles can express as a real :hover pseudo-
// class, so it's tracked via local state per item, same JS-hover
// pattern already established in components/ui/Button.tsx.
function NavItem({
  href,
  label,
  isActive,
  onNavigate,
}: {
  href: string;
  label: string;
  isActive: boolean;
  onNavigate?: () => void;
}) {
  const [hover, setHover] = useState(false);
  return (
    <Link
      href={href}
      onClick={onNavigate}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      aria-current={isActive ? "page" : undefined}
      style={{
        display: "block",
        padding: "10px 14px",
        borderRadius: "var(--radius-md)",
        font: "var(--text-body-sm)",
        fontWeight: isActive ? 600 : 400,
        color: isActive ? "var(--accent-subtle-text)" : "var(--text-secondary)",
        background: isActive ? "var(--accent-subtle)" : hover ? "var(--bg-surface-2)" : "transparent",
        textDecoration: "none",
      }}
    >
      {label}
    </Link>
  );
}

// No wordmark here — that lives in the top NavBar now, and repeating it
// in the drawer would mean the same word ("Начало"/Home) pointing at two
// different destinations on one screen (see NavBar.tsx's own comment on
// this). Sidebar owns only the dashboard's internal tabs.
export function DashboardSidebar({
  pulse,
  onNavigate,
}: {
  pulse: DashboardPulse;
  onNavigate?: () => void;
}) {
  const t = useTranslations("Dashboard");
  const pathname = usePathname();

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", padding: "var(--space-6) var(--space-4)" }}>
      <nav style={{ display: "flex", flexDirection: "column", gap: "var(--space-1)", flex: 1 }}>
        {NAV_ITEMS.map(({ href, key }) => (
          <NavItem key={href} href={href} label={t(`nav.${key}`)} isActive={pathname === href} onNavigate={onNavigate} />
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
    </div>
  );
}
