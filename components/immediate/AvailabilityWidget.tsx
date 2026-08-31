"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useTranslations } from "next-intl";
import {
  setAvailableNow,
  presenceTick,
  confirmImmediateRequest,
  declineImmediateRequest,
  type InboxRequest,
  type ImmediateBlockReason,
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
  // Why the practitioner can't be available right now — shown in a blocking modal
  // both when they try to turn it on with nothing bookable (§2) and when they're
  // auto-switched off because availability went stale (§4).
  const [blockReason, setBlockReason] = useState<ImmediateBlockReason | null>(null);
  const seen = useRef<Set<string>>(new Set());

  const goOffline = useCallback(() => {
    setAvailable(false);
    setRequests([]);
  }, []);

  async function enable() {
    setError(null);
    setBlockReason(null);
    if (typeof Notification === "undefined") return setError("noNotifications");
    let perm = Notification.permission;
    if (perm === "default") perm = await Notification.requestPermission();
    if (perm !== "granted") return setError("permissionRequired");
    setBusy(true);
    try {
      const res = await setAvailableNow(true);
      if (!res.ok) {
        // Nothing is bookable — do NOT activate; explain why instead.
        setBlockReason(res.reason);
        return;
      }
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
      if (!res.available) {
        // Auto-switched off because availability went stale — surface why.
        if (res.staleReason) setBlockReason(res.staleReason);
        return goOffline();
      }
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
      // eslint-disable-next-line react-hooks/set-state-in-effect
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

  // Dismiss the block modal on Escape.
  useEffect(() => {
    if (!blockReason) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setBlockReason(null);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [blockReason]);

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
        <span style={{ font: "var(--text-label)", textTransform: "uppercase", letterSpacing: "0.06em", color: available ? "var(--color-success)" : "var(--text-tertiary)" }}>
          {available ? `● ${t("statusOn")}` : t("statusOff")}
        </span>
      </div>

      {available ? (
        <>
          <p style={{ margin: 0, font: "var(--text-body-sm)", color: "var(--color-warning)" }}>{t("keepTabOpen")}</p>
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

      {error && <p style={{ margin: 0, font: "var(--text-body-sm)", color: "var(--color-danger)" }}>{t(`error_${error}` as Parameters<typeof t>[0])}</p>}

      {blockReason && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="imm-block-title"
          onClick={() => setBlockReason(null)}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.4)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "var(--space-4)",
            zIndex: 1000,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: "var(--bg-surface)",
              borderRadius: "var(--radius-lg)",
              boxShadow: "var(--shadow-lg)",
              padding: "var(--space-6)",
              maxWidth: 420,
              width: "100%",
              display: "flex",
              flexDirection: "column",
              gap: "var(--space-3)",
            }}
          >
            <span id="imm-block-title" style={{ font: "var(--text-heading-sm)", color: "var(--text-primary)" }}>
              {t("blockTitle")}
            </span>
            <p style={{ margin: 0, font: "var(--text-body-md)", color: "var(--text-secondary)" }}>{blockPrimary(t, blockReason)}</p>
            {blockReason.kind === "next_too_soon" && (
              <p style={{ margin: 0, font: "var(--text-body-md)", fontWeight: 600, color: "var(--text-primary)" }}>
                {t("block_next_too_soon_free", { time: blockReason.freeAtLabel })}
              </p>
            )}
            <div style={{ display: "flex", gap: "var(--space-2)", justifyContent: "flex-end", flexWrap: "wrap", marginTop: "var(--space-2)" }}>
              {blockReason.kind === "no_services" && (
                <Button href="/practitioner-dashboard/services" variant="secondary" size="sm">
                  {t("block_no_services_cta")}
                </Button>
              )}
              <Button type="button" size="sm" onClick={() => setBlockReason(null)}>
                {t("blockDismiss")}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// The primary line for each block reason. next_too_soon adds a second (bold) line
// naming when they could turn availability on; the rest are one line.
function blockPrimary(t: ReturnType<typeof useTranslations>, reason: ImmediateBlockReason): string {
  switch (reason.kind) {
    case "no_services":
      return t("block_no_services");
    case "in_session":
      return t("block_in_session");
    case "blocked":
      return t("block_blocked");
    case "next_too_soon":
      return t("block_next_too_soon", { minutes: reason.shortestDurationMinutes, startsIn: reason.nextSessionInMinutes });
  }
}
