"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { EARLY_JOIN_MS, sessionTimeState, withinJoinWindow } from "@/lib/video/sessionWindow";
import rowStyles from "./ResponsiveImageRow.module.css";

const INTL_LOCALES: Record<string, string> = { bg: "bg-BG", en: "en-US" };

// Same SSR-safe browser-timezone snapshot pattern as ClientTimezone /
// BookingsList — the browser zone can't be known during SSR, so the server
// and client snapshots differ safely (useSyncExternalStore re-renders on
// the client) rather than risking a hydration mismatch.
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

// The single join/rejoin affordance for an online session, shared by the
// dashboard "next session" hero and the sessions-list cards so the two can
// never drift apart again. The button is ALWAYS present for an active
// online booking — the /session route itself gates the room (a live
// countdown when opened early, the room within the window), so there's one
// obvious, identical way in from every surface. A live clock only changes
// how it reads: below the button, "opens at HH:MM" while the room is still
// closed, "in progress" once the session is live, nothing in between (the
// room is open and the button already says so). savedTimezone resolves the
// same way the surrounding session times do (saved -> detected -> UTC), so
// the "opens at" time matches the time shown just above it.
export function JoinSessionLink({
  bookingId,
  startUtc,
  endUtc,
  savedTimezone,
}: {
  bookingId: string;
  startUtc: string;
  endUtc: string;
  savedTimezone: string | null;
}) {
  const t = useTranslations("Booking");
  const locale = useLocale();
  const detected = useSyncExternalStore(subscribeToNothing, getDetectedTimezone, getServerSnapshot);
  const timeZone = savedTimezone ?? detected ?? "UTC";

  // Plain state + interval rather than a useSyncExternalStore snapshot of
  // Date.now() (which would change every read); BookingsList's clock uses
  // the same shape. null until mounted so SSR and first client render agree.
  const [nowMs, setNowMs] = useState<number | null>(null);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setNowMs(Date.now());
    const id = setInterval(() => setNowMs(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  const state = nowMs !== null ? sessionTimeState(startUtc, endUtc, nowMs) : "upcoming";
  const open = nowMs !== null && withinJoinWindow(startUtc, endUtc, nowMs);

  const opensAtLabel = new Intl.DateTimeFormat(INTL_LOCALES[locale] ?? "en-US", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone,
  }).format(new Date(new Date(startUtc).getTime() - EARLY_JOIN_MS));

  return (
    <div
      style={{
        marginTop: "var(--space-3)",
        display: "flex",
        flexDirection: "column",
        gap: "var(--space-2)",
        alignItems: "flex-start",
      }}
    >
      <Link
        href={`/session/${bookingId}`}
        className={`${rowStyles.tile} focus-ring`}
        style={{
          display: "inline-block",
          textAlign: "center",
          padding: "var(--button-padding-md)",
          borderRadius: "var(--radius-md)",
          background: "var(--accent)",
          color: "var(--text-on-accent)",
          font: "var(--text-button-md)",
          textDecoration: "none",
        }}
      >
        {t("joinVideoSession")}
      </Link>
      {state === "in_progress" ? (
        <p style={{ margin: 0, font: "var(--text-body-sm)", color: "var(--accent)" }}>{t("statusInProgress")}</p>
      ) : !open ? (
        <p style={{ margin: 0, font: "var(--text-body-sm)", color: "var(--text-tertiary)" }}>
          {t("roomOpensAt", { time: opensAtLabel })}
        </p>
      ) : null}
    </div>
  );
}
