"use client";

import { useState, useEffect } from "react";
import { useTranslations } from "next-intl";
import { getImmediateRequestStatus } from "@/lib/immediate/actions";
import { IMMEDIATE_CONFIG } from "@/lib/immediate/config";

const TERMINAL = new Set(["confirmed", "declined", "lapsed", "superseded"]);

// The client's side of the handshake. Polls the request's status while it's
// pending and STOPS the instant it resolves (or lapses) — a resolved request is
// never polled again, so a page left open can't poll indefinitely. Reused by the
// client discovery flow in the next slice; here it's the mechanism.
export function ImmediateRequestStatus({ requestId, expiresAt }: { requestId: string; expiresAt: string }) {
  const t = useTranslations("Immediate");
  const [status, setStatus] = useState<string>("pending");
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    if (TERMINAL.has(status)) return; // never poll a resolved request
    let active = true;
    const poll = async () => {
      try {
        const res = await getImmediateRequestStatus(requestId);
        if (active) setStatus(res.status);
      } catch {
        /* transient — keep trying until the server lapses it */
      }
    };
    void poll();
    const id = setInterval(poll, IMMEDIATE_CONFIG.CLIENT_POLL_MS);
    return () => {
      active = false;
      clearInterval(id);
    };
  }, [requestId, status]);

  useEffect(() => {
    if (TERMINAL.has(status)) return;
    const id = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(id);
  }, [status]);

  const remaining = Math.max(0, Math.round((new Date(expiresAt).getTime() - nowMs) / 1000));

  if (status === "pending") return <p style={{ font: "var(--text-body-md)" }}>{t("waiting", { seconds: remaining })}</p>;
  if (status === "confirmed") return <p style={{ font: "var(--text-body-md)", color: "#1e7f4f" }}>{t("confirmed")}</p>;
  if (status === "lapsed") return <p style={{ font: "var(--text-body-md)", color: "var(--text-secondary)" }}>{t("lapsed")}</p>;
  // declined + superseded read identically to the client — no reason given.
  return <p style={{ font: "var(--text-body-md)", color: "var(--text-secondary)" }}>{t("notAvailable")}</p>;
}
