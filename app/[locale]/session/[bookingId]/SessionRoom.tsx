"use client";

import { useEffect, useState } from "react";
import { useTranslations, useLocale } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { Button } from "@/components/ui/Button";
import { DeviceCheck, type JoinChoice } from "./DeviceCheck";
import { VideoStage } from "./VideoStage";
import { TroubleButton } from "./TroubleButton";
import styles from "./session.module.css";

type ServerState = "too_early" | "open" | "ended" | "unavailable";
type Phase = "window" | "device_check" | "in_room" | "disconnected";

const INTL_LOCALES: Record<string, string> = { bg: "bg-BG", en: "en-US" };

function formatCountdown(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

// The full-screen session orchestrator. Renders a fixed overlay (covering
// the site chrome) and drives the window → device-check → in-room →
// disconnected state machine. Server-provided window times let the
// countdown run with no polling; a drop routes to a Reconnect screen that
// re-mints a token, never a dead end.
export function SessionRoom({
  bookingId,
  initialState,
  opensAt,
  callerRole,
}: {
  bookingId: string;
  initialState: ServerState;
  opensAt: string | null;
  callerRole: "client" | "practitioner" | null;
}) {
  const t = useTranslations("Session");
  const locale = useLocale();
  const intlLocale = INTL_LOCALES[locale] ?? "en-US";
  const router = useRouter();

  const [windowState, setWindowState] = useState<ServerState>(initialState);
  const [phase, setPhase] = useState<Phase>(initialState === "open" ? "device_check" : "window");
  // Both null until the client computes them — anything derived from
  // Date.now() or the runtime timezone (the countdown, and the opens-at
  // time formatted in the viewer's local zone) differs between the server
  // render and the client and would hydrate-mismatch. The effect fills
  // them in on the client only.
  const [remaining, setRemaining] = useState<number | null>(null);
  const [openTimeLabel, setOpenTimeLabel] = useState<string | null>(null);
  const [conn, setConn] = useState<{ token: string; url: string } | null>(null);
  const [joinError, setJoinError] = useState<string | null>(null);
  // State, not a ref: it's read during render (passed to VideoStage) and
  // reused on rejoin, so it must trigger a re-render when it changes.
  const [choice, setChoice] = useState<JoinChoice | null>(null);

  // Countdown while too_early; flips to the device check the moment the
  // room opens, so a waiting user is carried in automatically.
  useEffect(() => {
    if (windowState !== "too_early" || !opensAt) return;
    // Client-only formatting on purpose — this is the fix for the SSR
    // timezone mismatch, not a pattern to avoid.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setOpenTimeLabel(
      new Intl.DateTimeFormat(intlLocale, { hour: "2-digit", minute: "2-digit" }).format(new Date(opensAt)),
    );
    const target = new Date(opensAt).getTime();
    const update = () => {
      const left = target - Date.now();
      if (left <= 0) {
        setWindowState("open");
        setPhase("device_check");
        return false;
      }
      setRemaining(left);
      return true;
    };
    if (!update()) return; // already open by the time the client mounted
    const id = setInterval(() => {
      if (!update()) clearInterval(id);
    }, 1000);
    return () => clearInterval(id);
  }, [windowState, opensAt, intlLocale]);

  const trouble = callerRole === "client" ? <TroubleButton bookingId={bookingId} /> : null;

  async function handleJoin(nextChoice: JoinChoice) {
    setChoice(nextChoice);
    setJoinError(null);
    try {
      const res = await fetch(`/api/video/${bookingId}/token`, { method: "POST" });
      if (res.ok) {
        const body = (await res.json()) as { token: string; url: string };
        setConn(body);
        setPhase("in_room");
        return;
      }
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (res.status === 403 && body.error === "too_late") {
        setWindowState("ended");
        setPhase("window");
      } else if (res.status === 403 && body.error === "too_early") {
        setWindowState("too_early");
        setPhase("window");
      } else if (res.status === 429) {
        setJoinError(t("rateLimited"));
      } else {
        setJoinError(t("joinFailed"));
      }
    } catch {
      setJoinError(t("joinFailed"));
    }
  }

  function leave() {
    router.push(callerRole === "practitioner" ? "/practitioner-dashboard" : "/client-dashboard");
  }

  if (phase === "in_room" && conn && choice) {
    return (
      <div className={styles.overlay}>
        <VideoStage
          token={conn.token}
          url={conn.url}
          choice={choice}
          onLeave={leave}
          onDropped={() => setPhase("disconnected")}
          trouble={trouble}
        />
      </div>
    );
  }

  if (phase === "disconnected") {
    return (
      <div className={styles.overlay}>
        <div className={styles.center}>
          <div className={styles.panel}>
            <span className={styles.bigIcon} aria-hidden>🔌</span>
            <h1 className={styles.title}>{t("disconnectedTitle")}</h1>
            <p className={styles.subtle}>{t("disconnectedBody")}</p>
            <div className={styles.actions}>
              <Button variant="primary" fullWidth onClick={() => choice && handleJoin(choice)}>
                {t("rejoin")}
              </Button>
              <Button variant="ghost" fullWidth onClick={leave}>
                {t("leaveSession")}
              </Button>
            </div>
            {trouble}
          </div>
        </div>
      </div>
    );
  }

  if (phase === "device_check") {
    return (
      <div className={styles.overlay}>
        <DeviceCheck onJoin={handleJoin} trouble={trouble} errorMessage={joinError} />
      </div>
    );
  }

  // phase === "window"
  return (
    <div className={styles.overlay}>
      <div className={styles.center}>
        <div className={styles.panel}>
          {windowState === "too_early" && (
            <>
              <span className={styles.bigIcon} aria-hidden>🕐</span>
              <h1 className={styles.title}>{t("opensAtTitle", { time: openTimeLabel ?? "…" })}</h1>
              <p className={styles.countdown}>{remaining !== null ? formatCountdown(remaining) : "—"}</p>
              <p className={styles.subtle}>{t("opensAtBody")}</p>
              {trouble}
            </>
          )}
          {windowState === "ended" && (
            <>
              <span className={styles.bigIcon} aria-hidden>✅</span>
              <h1 className={styles.title}>{t("endedTitle")}</h1>
              <p className={styles.subtle}>{t("endedBody")}</p>
              <Button variant="secondary" onClick={leave}>
                {t("backToDashboard")}
              </Button>
            </>
          )}
          {windowState === "unavailable" && (
            <>
              <span className={styles.bigIcon} aria-hidden>🚫</span>
              <h1 className={styles.title}>{t("unavailableTitle")}</h1>
              <p className={styles.subtle}>{t("unavailableBody")}</p>
              <Button variant="secondary" onClick={leave}>
                {t("backToDashboard")}
              </Button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
