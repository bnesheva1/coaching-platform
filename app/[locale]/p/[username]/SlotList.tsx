"use client";

import { useSyncExternalStore } from "react";
import { useTranslations, useLocale } from "next-intl";

const INTL_LOCALES: Record<string, string> = {
  bg: "bg-BG",
  en: "en-US",
};

// Same useSyncExternalStore pattern as ProfileForm.tsx's timezone
// detection (Epic 4) — the browser's timezone can't be known during SSR,
// so it must differ safely between the server snapshot and the client
// one. useEffect+setState would trip the react-hooks/set-state-in-effect
// rule and risk a hydration mismatch; this is the correct primitive.
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
function getServerTimezoneSnapshot(): string | null {
  return null;
}

export function SlotList({ slots }: { slots: { startUtc: string }[] }) {
  const t = useTranslations("Booking");
  const locale = useLocale();
  const intlLocale = INTL_LOCALES[locale] ?? "en-US";

  // Falls back to UTC only for the brief SSR/pre-hydration render — the
  // real browser zone takes over immediately after mount, same as
  // ProfileForm's detection.
  const clientTimezone = useSyncExternalStore(
    subscribeToNothing,
    getDetectedTimezone,
    getServerTimezoneSnapshot,
  ) ?? "UTC";

  if (slots.length === 0) {
    return <p style={{ color: "#666" }}>{t("noSlotsAvailable")}</p>;
  }

  const dayFormatter = new Intl.DateTimeFormat(intlLocale, {
    weekday: "long",
    month: "long",
    day: "numeric",
    timeZone: clientTimezone,
  });
  const timeFormatter = new Intl.DateTimeFormat(intlLocale, {
    hour: "numeric",
    minute: "2-digit",
    timeZone: clientTimezone,
  });

  const groups = new Map<string, Date[]>();
  for (const slot of slots) {
    const date = new Date(slot.startUtc);
    const dayKey = dayFormatter.format(date);
    const existing = groups.get(dayKey);
    if (existing) {
      existing.push(date);
    } else {
      groups.set(dayKey, [date]);
    }
  }

  return (
    <div>
      <p style={{ fontSize: "0.85rem", color: "#666" }}>
        {t("timesShownIn", { timezone: clientTimezone })}
      </p>
      {[...groups.entries()].map(([day, times]) => (
        <div key={day} style={{ marginBottom: "1rem" }}>
          <strong>{day}</strong>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem", marginTop: "0.25rem" }}>
            {times.map((time) => (
              <span
                key={time.toISOString()}
                style={{ border: "1px solid #ddd", padding: "0.25rem 0.5rem", borderRadius: 4 }}
              >
                {timeFormatter.format(time)}
              </span>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
