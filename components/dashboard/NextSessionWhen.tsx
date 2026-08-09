"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { EARLY_JOIN_MS } from "@/lib/video/sessionWindow";
import { Countdown } from "@/components/time/Countdown";
import { ClientLocalTime } from "./ClientTimezone";

// The next-session hero's time line, on both dashboards. Far out, it's a
// live minute countdown ("Следващата ти сесия след 1 ден 3 ч"); once the
// join window opens (or the session is live/past) it hands off to the exact
// local time — the join action below it is the thing to act on, so there's
// never a countdown ticking to zero.
//
// This wrapper owns the single interval (once a minute): it decides when to
// hand off, and feeds its own clock into Countdown (controlled), so the card
// runs exactly one timer. SSR and pre-mount render the time branch, matching
// ClientLocalTime's own client-only timezone resolution — no server-zone
// hydration mismatch.
export function NextSessionWhen({
  startUtc,
  savedTimezone,
}: {
  startUtc: string;
  savedTimezone: string | null;
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
  const joinWindowStart = startMs - EARLY_JOIN_MS;

  if (nowMs === null || nowMs >= joinWindowStart) {
    return <ClientLocalTime iso={startUtc} savedTimezone={savedTimezone} />;
  }

  return (
    <>
      {t("agenda.nextSessionIn")} <Countdown targetMs={startMs} mode="relative" nowMs={nowMs} />
    </>
  );
}
