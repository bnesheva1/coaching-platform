"use client";

import { useState } from "react";
import type { MouseEvent } from "react";
import { Link } from "@/i18n/navigation";

// Colors/shape ported directly from the approved design source
// (Practitioner Dashboard.dc.html's .om-navitem class + its per-item
// active/inactive style computation): active is a soft accent-tinted
// pill (--accent-subtle bg + --accent-subtle-text, not a solid gold
// fill), inactive is plain --text-secondary with a --bg-surface-2 hover
// — not something inline styles can express as a real :hover pseudo-
// class, so it's tracked via local state per item, same JS-hover
// pattern already established in components/ui/Button.tsx. Shared by
// both dashboards' sidebars — the practitioner one originated this
// pattern; the client sidebar reuses it verbatim rather than a second
// hand-copied variant.
export function NavItem({
  href,
  label,
  isActive,
  onNavigate,
  // Plain <a>, not next-intl's <Link> — for a same-page hash target
  // (the client dashboard's "Минали"/"Моите практикуващи", now in-page
  // sections rather than routes). Unused (false) for every other
  // caller, which are all real cross-route links.
  nativeAnchor = false,
  // Custom click handling for the nativeAnchor case — the client
  // dashboard's own smooth-scroll-to-section (and, for "Минали",
  // auto-expanding the past-sessions accordion) lives here, called
  // with the raw event so it can preventDefault() the browser's own
  // (confirmed unreliable — see ClientDashboardSidebar's own comment)
  // native hash-jump and drive the scroll itself instead.
  onClick,
}: {
  href: string;
  label: string;
  isActive: boolean;
  onNavigate?: () => void;
  nativeAnchor?: boolean;
  onClick?: (e: MouseEvent<HTMLAnchorElement>) => void;
}) {
  const [hover, setHover] = useState(false);
  const style = {
    display: "block",
    padding: "10px 14px",
    borderRadius: "var(--radius-md)",
    font: "var(--text-body-sm)",
    fontWeight: isActive ? 600 : 400,
    color: isActive ? "var(--accent-subtle-text)" : "var(--text-secondary)",
    background: isActive ? "var(--accent-subtle)" : hover ? "var(--bg-surface-2)" : "transparent",
    textDecoration: "none",
  } as const;

  function handleClick(e: MouseEvent<HTMLAnchorElement>) {
    onClick?.(e);
    onNavigate?.();
  }

  if (nativeAnchor) {
    return (
      <a
        href={href}
        onClick={handleClick}
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
        style={style}
      >
        {label}
      </a>
    );
  }

  return (
    <Link
      href={href}
      onClick={handleClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      aria-current={isActive ? "page" : undefined}
      style={style}
    >
      {label}
    </Link>
  );
}
