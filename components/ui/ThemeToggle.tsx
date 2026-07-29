"use client";

import { useSyncExternalStore } from "react";
import { useTheme } from "next-themes";
import { Button } from "./Button";

export type ThemeToggleProps = {
  switchToLightLabel?: string;
  switchToDarkLabel?: string;
  // Icon-only circular button (sun/moon glyph) for the header's desktop
  // row, where a full text button would crowd the other controls —
  // same useTheme()/mount-guard logic either way, just a different
  // presentation. aria-label carries the same "switch to X" text the
  // button variant shows visibly, and aria-pressed reflects the current
  // state (true once dark mode is active) so the toggle's state is
  // announced, not just its action.
  compact?: boolean;
};

// Same useSyncExternalStore pattern as BookingsList.tsx / SlotPicker.tsx /
// TimezoneField.tsx — resolvedTheme is undefined until next-themes' own
// client script runs, so server and client must render differently
// here too, safely, rather than via useEffect+setState (which forces an
// extra cascading render and is flagged by this project's lint config).
function subscribeToNothing() {
  return () => {};
}
function getMountedSnapshot() {
  return true;
}
function getServerMountedSnapshot() {
  return false;
}

export function ThemeToggle({
  switchToLightLabel = "Light mode",
  switchToDarkLabel = "Dark mode",
  compact = false,
}: ThemeToggleProps) {
  const { resolvedTheme, setTheme } = useTheme();
  const mounted = useSyncExternalStore(subscribeToNothing, getMountedSnapshot, getServerMountedSnapshot);

  if (compact) {
    // Same size/shape as DashboardShell's own desktop sidebar-collapse
    // toggle (28px, 8px radius, border-only when "off") — the header's
    // one other icon-button precedent.
    // Pre-mount, resolvedTheme is unknown — same fallback assumption as
    // the text variant below (defaults to showing "switch to dark",
    // i.e. assumes light), just disabled rather than hidden, so there's
    // no layout shift once the real value swaps in post-mount.
    const isDark = mounted && resolvedTheme === "dark";
    const label = isDark ? switchToLightLabel : switchToDarkLabel;
    return (
      <button
        type="button"
        className="focus-ring"
        disabled={!mounted}
        aria-label={label}
        aria-pressed={isDark}
        onClick={() => setTheme(isDark ? "light" : "dark")}
        style={{
          width: 28,
          height: 28,
          borderRadius: "8px",
          border: "1px solid var(--border-subtle)",
          background: "var(--bg-surface)",
          color: "var(--text-tertiary)",
          font: "var(--text-icon)",
          cursor: mounted ? "pointer" : "default",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <span aria-hidden="true">{isDark ? "☀" : "☾"}</span>
      </button>
    );
  }

  if (!mounted) {
    return (
      <Button variant="secondary" size="sm" disabled>
        {switchToDarkLabel}
      </Button>
    );
  }

  const isDark = resolvedTheme === "dark";
  return (
    <Button variant="secondary" size="sm" onClick={() => setTheme(isDark ? "light" : "dark")}>
      {isDark ? switchToLightLabel : switchToDarkLabel}
    </Button>
  );
}
