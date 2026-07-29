"use client";

import { useSyncExternalStore } from "react";
import { useTranslations } from "next-intl";

// Same useSyncExternalStore pattern as every other "the server can't
// know this" value in this app (browser timezone in SlotPicker.tsx/
// TimezoneField.tsx, resolvedTheme in ThemeToggle.tsx): the server has
// no idea what time it is for this specific visitor, so it renders the
// existing time-neutral "greeting" key through hydration, then swaps to
// the real local-hour-based greeting right after mount — a real
// subscription-free snapshot read, not a useEffect+setState render.
function subscribeToNothing() {
  return () => {};
}
function getHourSnapshot() {
  return new Date().getHours();
}
function getServerHourSnapshot() {
  return null;
}

// Three buckets, not a "night" fourth one — late-night/very-early hours
// fold into "evening" rather than an easy-to-get-wrong extra threshold;
// this is the same simple scheme most greeting widgets use.
function greetingKeyForHour(hour: number): "greetingMorning" | "greetingAfternoon" | "greetingEvening" {
  if (hour >= 5 && hour < 12) return "greetingMorning";
  if (hour >= 12 && hour < 18) return "greetingAfternoon";
  return "greetingEvening";
}

export function GreetingText({ name }: { name: string }) {
  const t = useTranslations("Dashboard");
  const hour = useSyncExternalStore(subscribeToNothing, getHourSnapshot, getServerHourSnapshot);
  const key = hour === null ? "agenda.greeting" : `agenda.${greetingKeyForHour(hour)}`;
  return <>{t(key, { name })}</>;
}
