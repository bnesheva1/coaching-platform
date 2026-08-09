"use client";

import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { POST_SESSION_GRACE_MS } from "@/lib/video/sessionWindow";
import { Countdown } from "@/components/time/Countdown";
import { ClientLocalTime } from "./ClientTimezone";

// The live timer in the next-session hero's eyebrow, on both dashboards. It
// carries two of the four countdown states, switching at the scheduled start:
//   - Before  (state 1): "Следваща сесия след 1 ден 3 ч" — minute countdown
//     down to the start.
//   - Running (state 3): "Сесията тече от 12 мин" — minute count-UP from the
//     scheduled start (NOT from when anyone joined a room, and independent of
//     whether a room exists), until the session's end.
// Outside those (pre-mount, or once the session is over and the hero is about
// to drop) it renders `fallback` — the plain "Next session" label — rather
// than a long date-time; without a fallback it defaults to the exact time.
//
// One interval (once a minute), fed into Countdown as a controlled clock, so
// the card runs a single timer. SSR/pre-mount render the fallback branch, and
// the client-only timezone resolution keeps the exact-time default off the
// server-zone hydration bug.
export function NextSessionWhen({
  startUtc,
  endUtc,
  savedTimezone,
  fallback,
}: {
  startUtc: string;
  endUtc: string;
  savedTimezone: string | null;
  fallback?: ReactNode;
}) {
  const t = useTranslations("Dashboard");
  const [nowMs, setNowMs] = useState<number | null>(null);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setNowMs(Date.now());
    const id = setInterval(() => setNowMs(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);

  const startMs = new Date(startUtc).getTime();
  const closesMs = new Date(endUtc).getTime() + POST_SESSION_GRACE_MS;
  const idle = <>{fallback ?? <ClientLocalTime iso={startUtc} savedTimezone={savedTimezone} />}</>;

  if (nowMs === null || nowMs >= closesMs) {
    return idle;
  }

  // State 3: in progress — count up from the scheduled start.
  if (nowMs >= startMs) {
    return (
      <>
        {t("agenda.sessionRunningFor")} <Countdown targetMs={startMs} mode="relative" countUp nowMs={nowMs} />
      </>
    );
  }

  // State 1: before — count down to the scheduled start.
  return (
    <>
      {t("agenda.nextSessionIn")} <Countdown targetMs={startMs} mode="relative" nowMs={nowMs} />
    </>
  );
}
