"use client";

import { useSyncExternalStore } from "react";
import { useTranslations, useLocale } from "next-intl";
import { Link } from "@/i18n/navigation";
import { bookSlot } from "./booking-actions";

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

export function SlotList({
  slots,
  practitionerId,
  serviceId,
  username,
  viewerRole,
}: {
  slots: { startUtc: string }[];
  practitionerId: string;
  serviceId: string;
  username: string;
  viewerRole: "client" | "practitioner" | null;
}) {
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

  const groups = new Map<string, { startUtc: string; date: Date }[]>();
  for (const slot of slots) {
    const date = new Date(slot.startUtc);
    const dayKey = dayFormatter.format(date);
    const existing = groups.get(dayKey);
    if (existing) {
      existing.push({ startUtc: slot.startUtc, date });
    } else {
      groups.set(dayKey, [{ startUtc: slot.startUtc, date }]);
    }
  }

  return (
    <div>
      <p style={{ fontSize: "0.85rem", color: "#666" }}>
        {t("timesShownIn", { timezone: clientTimezone })}
      </p>
      {viewerRole === "practitioner" && (
        <p style={{ fontSize: "0.85rem", color: "#666" }}>{t("onlyClientsCanBook")}</p>
      )}
      {viewerRole === null && (
        <p style={{ fontSize: "0.85rem", color: "#666" }}>
          {t.rich("logInToBookPrompt", {
            login: (chunks) => <Link href="/login">{chunks}</Link>,
          })}
        </p>
      )}
      {[...groups.entries()].map(([day, daySlots]) => (
        <div key={day} style={{ marginBottom: "1rem" }}>
          <strong>{day}</strong>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem", marginTop: "0.25rem" }}>
            {daySlots.map((slot) =>
              viewerRole === "client" ? (
                <form
                  key={slot.startUtc}
                  action={bookSlot.bind(null, practitionerId, serviceId, username, slot.startUtc)}
                  onSubmit={(e) => {
                    if (!confirm(t("confirmBooking", { time: timeFormatter.format(slot.date) }))) {
                      e.preventDefault();
                    }
                  }}
                >
                  <button
                    type="submit"
                    style={{ border: "1px solid #ddd", padding: "0.25rem 0.5rem", borderRadius: 4 }}
                  >
                    {timeFormatter.format(slot.date)}
                  </button>
                </form>
              ) : (
                <span
                  key={slot.startUtc}
                  style={{ border: "1px solid #ddd", padding: "0.25rem 0.5rem", borderRadius: 4, color: "#999" }}
                >
                  {timeFormatter.format(slot.date)}
                </span>
              ),
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
