"use client";

import { useSyncExternalStore } from "react";

// 860px matches the breakpoint used in the approved practitioner-dashboard
// design source (`isMobile = window.innerWidth < 860`), not an invented
// value — kept here as the one place it's defined since nothing in this
// project had a breakpoint convention before this.
const QUERY = "(max-width: 860px)";

function subscribe(callback: () => void) {
  const mql = window.matchMedia(QUERY);
  mql.addEventListener("change", callback);
  return () => mql.removeEventListener("change", callback);
}

function getSnapshot() {
  return window.matchMedia(QUERY).matches;
}

// Server has no viewport, so it can't know the real breakpoint — false
// (desktop) is the safer server snapshot: it's already this project's
// default assumption (no page here has ever had mobile-specific layout),
// and useSyncExternalStore swaps to the real value right after hydration
// without a mismatch warning, same pattern as ThemeToggle.tsx's mount
// guard and ProfileForm.tsx's browser-timezone detection.
function getServerSnapshot() {
  return false;
}

export function useIsMobile(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
