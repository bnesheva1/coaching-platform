"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { formatClock, relativeParts, type CountdownUnit } from "@/lib/time/countdown";

const UNIT_KEY: Record<CountdownUnit, "day" | "hour" | "minute"> = {
  day: "day",
  hour: "hour",
  minute: "minute",
};

// The one countdown across the whole app — the in-session end warning, the
// waiting room, and the dashboard next-session card all render this.
//
// "clock" mode = seconds (H:MM:SS / M:SS); "relative" mode = the units-and-
// plurals form ("1 ден 3 ч"), which ticks once a MINUTE.
//
// `countUp` flips the direction: down to `targetMs` (default), or up since it
// (the "session running for 12 min" timer, measured from the scheduled
// start). Either way the value handed to the formatter is clamped at zero.
//
// It self-ticks when standalone, but accepts a controlled `nowMs`: the two
// session views already tick every second (for their hard-stop / auto-
// advance side effects), so they pass that same clock in and this adds no
// second interval. Everything is computed from `now` on the client, so the
// old server-timezone hydration bug can't come back through here.
export function Countdown({
  targetMs,
  mode,
  countUp = false,
  nowMs,
  className,
}: {
  targetMs: number;
  mode: "clock" | "relative";
  countUp?: boolean;
  nowMs?: number | null;
  className?: string;
}) {
  const t = useTranslations("Countdown");
  const controlled = nowMs !== undefined;
  const [selfNow, setSelfNow] = useState<number | null>(null);

  useEffect(() => {
    if (controlled) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSelfNow(Date.now());
    const period = mode === "relative" ? 60_000 : 1000;
    const id = setInterval(() => setSelfNow(Date.now()), period);
    return () => clearInterval(id);
  }, [controlled, mode]);

  const now = controlled ? nowMs : selfNow;

  // role="timer" is a live region whose implicit aria-live is "off": a
  // screen reader reads it on navigation but is never interrupted on a tick
  // — the required "doesn't announce on every tick" behaviour.
  if (now == null) {
    return <span className={className} role="timer" aria-live="off" />;
  }

  const ms = countUp ? now - targetMs : targetMs - now;
  const text =
    mode === "clock"
      ? formatClock(ms)
      : relativeParts(ms)
          .map((p) => t(UNIT_KEY[p.unit], { value: p.value }))
          .join(" ");

  return (
    <span className={className} role="timer" aria-live="off">
      {text}
    </span>
  );
}
