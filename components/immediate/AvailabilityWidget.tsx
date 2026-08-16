"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useTranslations } from "next-intl";
import {
  setAvailableNow,
  presenceTick,
  confirmImmediateRequest,
  declineImmediateRequest,
  type InboxRequest,
} from "@/lib/immediate/actions";
import { IMMEDIATE_CONFIG } from "@/lib/immediate/config";
import { Button } from "@/components/ui/Button";

// The practitioner's "available now" surface. Presence is OBSERVED (a ~10s tick
// that refreshes the heartbeat and pulls the inbox), never merely declared, and
// degrades to offline on any failure or when the tab is backgrounded. Enabling
// requires notification permission — a practitioner who can't be alerted can't
// answer a request in time.
export function AvailabilityWidget({ initialAvailable }: { initialAvailable: boolean }) {
  const t = useTranslations("Immediate");
  const [available, setAvailable] = useState(initialAvailable);
  const [requests, setRequests] = useState<InboxRequest[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const seen = useRef<Set<string>>(new Set());

  const goOffline = useCallback(() => {
    setAvailable(false);
    setRequests([]);
  }, []);

  async function enable() {
    setError(null);
    if (typeof Notification === "undefined") return setError("noNotifications");
    let perm = Notification.permission;
    if (perm === "default") perm = await Notification.requestPermission();
    if (perm !== "granted") return setError("permissionRequired");
    setBusy(true);
    try {
      await setAvailableNow(true);
      seen.current.clear();
      setAvailable(true);
    } finally {
      setBusy(false);
    }
  }

  async function disable() {
    setBusy(true);
    try {
      await setAvailableNow(false);
    } finally {
      setBusy(false);
      goOffline();
    }
  }

  // One tick: heartbeat + inbox. Notifies on each newly-seen request. Any error,
  // or the server reporting we're no longer available, drops us to offline.
  const tick = useCallback(async () => {
    try {
      const res = await presenceTick();
      if (!res.available) return goOffline();
      for (const r of res.requests) {
        if (!seen.current.has(r.id)) {
          seen.current.add(r.id);
          try {
            new Notification(t("notifTitle"), { body: t("notifBody", { client: r.clientName, service: r.serviceName }) });
          } catch {
            /* notifications best-effort */
          }
        }
      }
      setRequests(res.requests);
    } catch {
      setError("offline");
      goOffline();
    }
  }, [t, goOffline]);

  // Tick loop while available + visible; stop (→ presence goes stale → offline)
  // when the tab is hidden. pagehide is a best-effort early offline.
  useEffect(() => {
    if (!available) return;
    if (document.visibilityState !== "visible") {
      goOffline();
      return;
    }
    void tick();
    const id = setInterval(() => {
      if (document.visibilityState === "visible") void tick();
      else goOffline();
    }, IMMEDIATE_CONFIG.TICK_INTERVAL_MS);
    const onVisibility = () => {
      if (document.visibilityState === "hidden") goOffline();
    };
    const onHide = () => void setAvailableNow(false).catch(() => {});
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", onHide);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", onHide);
    };
  }, [available, tick, goOffline]);

  // 1s clock for the per-request countdowns.
  useEffect(() => {
    if (!available) return;
    const id = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(id);
  }, [available]);

  async function respond(id: string, action: (id: string) => Promise<unknown>) {
    setBusy(true);
    try {
      await action(id);
      await tick();
    } finally {
      setBusy(false);
    }
  }

  const cardStyle = {
    border: "1px solid var(--border-subtle)",
    borderRadius: "var(--radius-lg)",
    padding: "var(--space-4)",
    display: "flex",
    flexDirection: "column" as const,
    gap: "var(--space-3)",
  };

  return (
    <div style={cardStyle}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "var(--space-3)", flexWrap: "wrap" }}>
        <span style={{ font: "var(--text-heading-sm)" }}>{t("heading")}</span>
        <span style={{ font: "var(--text-label)", textTransform: "uppercase", letterSpacing: "0.06em", color: available ? "#1e7f4f" : "var(--text-tertiary)" }}>
          {available ? `● ${t("statusOn")}` : t("statusOff")}
        </span>
      </div>

      {available ? (
        <>
          <p style={{ margin: 0, font: "var(--text-body-sm)", color: "#a15c00" }}>{t("keepTabOpen")}</p>
          <div style={{ alignSelf: "flex-start" }}>
            <Button type="button" variant="secondary" size="sm" disabled={busy} onClick={disable}>
              {t("goOffline")}
            </Button>
          </div>

          {requests.length > 0 && (
            <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
              {requests.map((r) => {
                const remaining = Math.max(0, Math.round((new Date(r.expiresAt).getTime() - nowMs) / 1000));
                return (
                  <div key={r.id} style={{ border: "1px solid var(--border-default)", borderRadius: "var(--radius-md)", padding: "var(--space-3)", display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
                    <span style={{ font: "var(--text-body-md)" }}>{t("requestLine", { client: r.clientName, service: r.serviceName })}</span>
                    <span style={{ font: "var(--text-body-sm)", color: "var(--text-tertiary)", fontVariantNumeric: "tabular-nums" }}>{t("respondWithin", { seconds: remaining })}</span>
                    <div style={{ display: "flex", gap: "var(--space-2)" }}>
                      <Button type="button" size="sm" disabled={busy || remaining === 0} onClick={() => respond(r.id, confirmImmediateRequest)}>
                        {t("confirm")}
                      </Button>
                      <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => respond(r.id, declineImmediateRequest)}>
                        {t("decline")}
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </>
      ) : (
        <>
          <p style={{ margin: 0, font: "var(--text-body-sm)", color: "var(--text-secondary)" }}>{t("explainer")}</p>
          <div style={{ alignSelf: "flex-start" }}>
            <Button type="button" size="sm" disabled={busy} onClick={enable}>
              {t("goAvailable")}
            </Button>
          </div>
        </>
      )}

      {error && <p style={{ margin: 0, font: "var(--text-body-sm)", color: "#c0392b" }}>{t(`error_${error}` as Parameters<typeof t>[0])}</p>}
    </div>
  );
}
