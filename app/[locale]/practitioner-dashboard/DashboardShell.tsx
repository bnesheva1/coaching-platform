"use client";

import { useState } from "react";
import type { ReactNode } from "react";
import { useTranslations } from "next-intl";
import { useIsMobile } from "@/lib/useIsMobile";
import { ContentContainer } from "@/components/ui/ContentContainer";
import { DashboardSidebar, type DashboardPulse } from "./DashboardSidebar";

const SIDEBAR_WIDTH = 220;

// Desktop starts open, mobile starts closed — the drawer pushes content
// on desktop (a plain flex sibling whose width animates) and overlays it
// on mobile (fixed position + scrim), per the approved design's own
// split. The toggle button that controls this belongs to the page, not
// to NavBar — it sits just below the top bar, always at the same
// position, only its icon/behavior differs per breakpoint (gear +
// overlay-open on mobile, circle-arrow + fold/unfold on desktop).
export function DashboardShell({
  pulse,
  children,
}: {
  pulse: DashboardPulse;
  children: ReactNode;
}) {
  const t = useTranslations("Dashboard");
  const isMobile = useIsMobile();
  const [desktopOpen, setDesktopOpen] = useState(true);
  const [mobileOpen, setMobileOpen] = useState(false);

  const open = isMobile ? mobileOpen : desktopOpen;
  const toggle = () => (isMobile ? setMobileOpen((v) => !v) : setDesktopOpen((v) => !v));
  const closeMobile = () => setMobileOpen(false);

  // Desktop toggle styling ported directly from the approved design
  // source (Practitioner Dashboard.dc.html): 28px, 8px radius (not a
  // pill/circle), var(--text-tertiary) — not one of this project's
  // existing radius tokens (6px/10px), kept as the literal value from
  // the source rather than rounded onto the nearest token. Two distinct
  // treatments per state: no border/transparent while open (matches the
  // source's in-sidebar collapse control), bordered/on-surface while
  // closed (matches the source's floating expand control) — even though
  // both are now the same single button per this app's own simplified
  // architecture (one button, one position, not the source's two).
  const desktopToggleStyle = {
    width: 28,
    height: 28,
    borderRadius: "8px",
    border: open ? "none" : "1px solid var(--border-subtle)",
    background: open ? "transparent" : "var(--bg-surface)",
    color: "var(--text-tertiary)",
    font: "var(--text-icon)",
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  } as const;

  const mobileToggleStyle = {
    width: 36,
    height: 36,
    borderRadius: "var(--radius-sm)",
    border: "1px solid var(--border-strong)",
    background: "var(--bg-surface)",
    color: "var(--text-primary)",
    font: "var(--text-icon)",
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  } as const;

  return (
    <div>
      {/* The whole sidebar+content row (not just the page content inside
          it) is bounded to --content-max-width and centered, same as
          every other page's chrome — otherwise the sidebar sits flush
          against the real viewport edge on wide screens instead of
          starting at the same left edge as the rest of the site's
          content column. The mobile drawer/scrim below stay
          viewport-relative regardless (position: fixed escapes this
          wrapper — it has no transform/filter to create a new
          containing block). */}
      <ContentContainer>
        {/* Desktop: the button sits at the right edge of the sidebar
            column (matching the design source, where the collapse
            control lives inside the sidebar itself, pushed to its far
            edge via justify-content:space-between) — width matches
            SIDEBAR_WIDTH only while open, so it aligns with the actual
            drawer's border line; once collapsed there's no drawer edge
            to align to, so it falls back to the row's own left edge,
            near where content now starts. Mobile is unaffected — its
            gear button stays at the row's left edge, per its own
            established position ("top-left of the page, beneath the
            top bar"). */}
        <div
          style={{
            padding: "var(--space-3) 0 0",
            display: "flex",
            justifyContent: !isMobile && open ? "flex-end" : "flex-start",
            width: !isMobile && open ? SIDEBAR_WIDTH : undefined,
          }}
        >
          <button
            type="button"
            onClick={toggle}
            aria-label={
              isMobile
                ? open
                  ? t("sidebarClose")
                  : t("sidebarOpen")
                : open
                  ? t("sidebarCollapse")
                  : t("sidebarExpand")
            }
            aria-expanded={open}
            style={isMobile ? mobileToggleStyle : desktopToggleStyle}
          >
            {isMobile ? "⚙" : open ? "‹" : "›"}
          </button>
        </div>

        <div style={{ display: "flex", alignItems: "stretch", position: "relative" }}>
          <div
            style={{
              width: isMobile ? SIDEBAR_WIDTH : open ? SIDEBAR_WIDTH : 0,
              flexShrink: 0,
              overflow: "hidden",
              transition: "width var(--duration-base) var(--ease-standard)",
              borderRight: !isMobile && open ? "1px solid var(--border-subtle)" : "none",
              // Desktop: no card-surface fill — blends into the page
              // background (--bg-page), matching the design source
              // exactly (its desktop sidebar uses background:var(--bg-
              // page); only the mobile overlay panel keeps a surface
              // fill + shadow, since it needs to visually separate from
              // the dimmed scrim behind it).
              background: isMobile ? "var(--bg-surface)" : "var(--bg-page)",
              ...(isMobile
                ? {
                    position: "fixed" as const,
                    top: 0,
                    bottom: 0,
                    left: 0,
                    width: open ? "min(260px, 80vw)" : 0,
                    zIndex: 41,
                    boxShadow: open ? "var(--shadow-lg)" : "none",
                  }
                : {}),
            }}
          >
            <div style={{ width: isMobile ? "min(260px, 80vw)" : SIDEBAR_WIDTH }}>
              <DashboardSidebar pulse={pulse} onNavigate={isMobile ? closeMobile : undefined} />
            </div>
          </div>

          {isMobile && open && (
            <div
              onClick={closeMobile}
              style={{
                position: "fixed",
                inset: 0,
                background: "var(--overlay-scrim)",
                zIndex: 40,
              }}
            />
          )}

          {/* A plain div, not <main> — each page already renders its own
              <main> landmark; nesting two would be an accessibility bug
              (screen readers expect exactly one per page). Horizontal
              padding only (44px desktop / 16px mobile, ported from the
              design source's mainPadding: '32px 44px' / '20px 16px' — 44px
              doesn't land on this project's --space-N grid, same
              situation as --field-padding, kept as the literal source
              value rather than rounded) — this is the gap from the
              sidebar's vertical border line to the content; each page's
              own <main> still supplies its own vertical padding, so this
              only adds the missing horizontal axis, not a duplicate. */}
          <div style={{ flex: 1, minWidth: 0, padding: isMobile ? "0 var(--space-4)" : "0 2.75rem" }}>
            {children}
          </div>
        </div>
      </ContentContainer>
    </div>
  );
}
