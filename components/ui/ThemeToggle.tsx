"use client";

import { useSyncExternalStore } from "react";
import { useTheme } from "next-themes";
import { Button } from "./Button";

export type ThemeToggleProps = {
  switchToLightLabel?: string;
  switchToDarkLabel?: string;
};

// Same useSyncExternalStore pattern as BookingsList.tsx / SlotPicker.tsx /
// ScheduleSettingsForm.tsx — resolvedTheme is undefined until next-themes' own
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
}: ThemeToggleProps) {
  const { resolvedTheme, setTheme } = useTheme();
  const mounted = useSyncExternalStore(subscribeToNothing, getMountedSnapshot, getServerMountedSnapshot);

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
