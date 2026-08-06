"use client";

import { useSyncExternalStore } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";

const INTL_LOCALES: Record<string, string> = { bg: "bg-BG", en: "en-US" };

// Same SSR-safe browser-timezone snapshot pattern as BookingsList /
// SlotPicker / TimezoneField — the browser zone can't be known during
// SSR, so server and client snapshots must differ safely.
function subscribeToNothing() {
  return () => {};
}
function getDetectedTimezone(): string | null {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return null;
  }
}
function getServerSnapshot(): string | null {
  return null;
}

// The one resolution order for everything a CLIENT sees: their saved
// timezone (profiles.timezone) wins; otherwise the browser's guess;
// otherwise UTC. Saved is known server-side, but detection is client-only,
// so this lives in a client component — which is exactly why the old
// server-rendered hero formatted in the server's zone (UTC on Vercel).
function useClientTimezone(savedTimezone: string | null): string {
  const detected = useSyncExternalStore(subscribeToNothing, getDetectedTimezone, getServerSnapshot);
  return savedTimezone ?? detected ?? "UTC";
}

// A single booking time, formatted in the client's own timezone. Replaces
// the server-side Intl formatter the dashboard hero used, which had no
// timeZone and so rendered in the server's zone.
export function ClientLocalTime({
  iso,
  savedTimezone,
}: {
  iso: string;
  savedTimezone: string | null;
}) {
  const locale = useLocale();
  const timeZone = useClientTimezone(savedTimezone);
  const formatted = new Intl.DateTimeFormat(INTL_LOCALES[locale] ?? "en-US", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone,
  }).format(new Date(iso));
  return <>{formatted}</>;
}

// The dashboard's "times shown in <tz>" caption with a link to change it
// in settings. Named so it reads as a tooltip on hover too (title attr).
export function ClientTimezoneNotice({ savedTimezone }: { savedTimezone: string | null }) {
  const t = useTranslations("Dashboard");
  const timeZone = useClientTimezone(savedTimezone);
  return (
    <p
      title={t("agenda.timezoneTooltip")}
      style={{ margin: "0 0 var(--space-5)", font: "var(--text-body-sm)", color: "var(--text-tertiary)" }}
    >
      {t("agenda.timezoneNotice", { timezone: timeZone })}{" "}
      <Link href="/client-dashboard/settings" style={{ color: "var(--accent)" }}>
        {t("agenda.timezoneChangeLink")}
      </Link>
    </p>
  );
}
