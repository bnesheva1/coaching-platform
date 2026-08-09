"use client";

import { useEffect, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Link, usePathname } from "@/i18n/navigation";
import { EARLY_JOIN_MS } from "@/lib/video/sessionWindow";
import { NextSessionWhen } from "@/components/dashboard/NextSessionWhen";
import { getImminentCallSession, type CallPromptSession } from "@/app/session-call-actions";

const INTL_LOCALES: Record<string, string> = { bg: "bg-BG", en: "en-US" };

// Global "your call is ready" prompt, mounted once in the root layout so it
// appears on ANY page for both parties. It shows from 5 minutes before the
// start (when the waiting room opens) through the scheduled end — NOT the
// post-session grace — so leaving the call mid-session re-prompts, but once
// the session's own time is over it stops nagging. Hidden while actually on
// the /session page (you're in the call).
export function SessionCallPrompt({ initialSession }: { initialSession: CallPromptSession | null }) {
  const t = useTranslations("SessionPrompt");
  const tBooking = useTranslations("Booking");
  const locale = useLocale();
  const pathname = usePathname();

  const [session, setSession] = useState<CallPromptSession | null>(initialSession);
  const [nowMs, setNowMs] = useState<number | null>(null);
  const [dismissedId, setDismissedId] = useState<string | null>(null);

  // Client clock — drives the exact show window between polls.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setNowMs(Date.now());
    const id = setInterval(() => setNowMs(Date.now()), 5000);
    return () => clearInterval(id);
  }, []);

  // Refresh the session periodically — the layout's server render seeds it,
  // but client-side navigation never re-runs that, so poll to stay current.
  useEffect(() => {
    let active = true;
    const id = setInterval(() => {
      getImminentCallSession()
        .then((s) => {
          if (active) setSession(s);
        })
        .catch(() => {});
    }, 60_000);
    return () => {
      active = false;
      clearInterval(id);
    };
  }, []);

  // On the call page, they're in the session — clear any dismissal so that
  // leaving re-shows the prompt for the rest of the session's time.
  const onSessionPage = pathname.startsWith("/session/");
  useEffect(() => {
    if (onSessionPage) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setDismissedId(null);
    }
  }, [onSessionPage]);

  const start = session ? new Date(session.startUtc).getTime() : 0;
  const end = session ? new Date(session.endUtc).getTime() : 0;
  const live = session !== null && nowMs !== null && nowMs >= start;

  // A dismissed "starting soon" prompt re-appears the moment the call
  // actually goes live — a real "it's happening now" nudge.
  const prevLive = useRef(false);
  useEffect(() => {
    if (live && !prevLive.current) {
      setDismissedId(null);
    }
    prevLive.current = live;
  }, [live]);

  // Escape dismisses, matching the backdrop click / native-dialog feel.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && session) setDismissedId(session.bookingId);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [session]);

  if (!session || nowMs === null) return null;
  const inWindow = nowMs >= start - EARLY_JOIN_MS && nowMs <= end;
  if (!inWindow || onSessionPage || dismissedId === session.bookingId) return null;

  const timeLabel = new Intl.DateTimeFormat(INTL_LOCALES[locale] ?? "en-US", { hour: "2-digit", minute: "2-digit" }).format(
    new Date(session.startUtc),
  );

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t(live ? "inProgressEyebrow" : "startingSoonEyebrow")}
      onClick={() => setDismissedId(session.bookingId)}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 120,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "var(--space-4)",
        background: "var(--overlay-scrim)",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "100%",
          maxWidth: 380,
          background: "var(--bg-surface)",
          borderRadius: "var(--radius-2xl)",
          boxShadow: "var(--shadow-lg)",
          padding: "var(--space-6)",
          display: "flex",
          flexDirection: "column",
          gap: "var(--space-4)",
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "var(--space-2)",
              font: "var(--text-label)",
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              color: "var(--accent)",
            }}
          >
            <span aria-hidden style={{ width: 8, height: 8, borderRadius: "50%", background: "var(--accent)" }} />
            {/* Same live timer as the next-session card: counts down to the
                start while upcoming ("Следваща сесия след 4 мин"), then up
                from the start while running ("Сесията тече от 12 мин"). The
                modal always sits inside [start−early-join, end], so
                NextSessionWhen never hits its idle branch; the fallback only
                covers its first pre-mount tick. */}
            <NextSessionWhen
              startUtc={session.startUtc}
              endUtc={session.endUtc}
              savedTimezone={null}
              fallback={t(live ? "inProgressEyebrow" : "startingSoonEyebrow")}
            />
          </span>
          <strong style={{ font: "var(--text-heading-md)" }}>{session.serviceName}</strong>
          <p style={{ margin: 0, font: "var(--text-body-sm)", color: "var(--text-secondary)" }}>
            {t("withCounterpart", { name: session.counterpartName })} · {timeLabel}
          </p>
        </div>

        <Link
          href={`/session/${session.bookingId}`}
          className="focus-ring"
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
          {tBooking("joinVideoSession")}
        </Link>

        <button
          type="button"
          className="focus-ring"
          onClick={() => setDismissedId(session.bookingId)}
          style={{
            background: "none",
            border: "none",
            padding: "var(--space-1)",
            font: "var(--text-body-sm)",
            color: "var(--text-tertiary)",
            cursor: "pointer",
          }}
        >
          {t("dismiss")}
        </button>
      </div>
    </div>
  );
}
