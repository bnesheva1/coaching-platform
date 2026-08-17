"use client";

import { useEffect, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { Button } from "@/components/ui/Button";
import {
  createImmediateRequest,
  getImmediateRequestStatus,
  startImmediatePayment,
} from "@/lib/immediate/actions";
import { IMMEDIATE_CONFIG } from "@/lib/immediate/config";

// The client's inline immediate-booking flow, living ON the service card (per the
// product decision: no dedicated waiting page — the client stays on the profile
// until Stripe Checkout takes over, exactly like an ordinary booking). Rendered
// only when the practitioner is available now AND this service fits the gap.
//
// State machine (poll STOPS on any terminal transition):
//   idle → click „Резервирай сега" → createImmediateRequest → pending
//   pending (poll getImmediateRequestStatus + countdown):
//     confirmed        → startImmediatePayment → redirect to Stripe (commission)
//     booked           → redirect to the confirmation page (software_provider)
//     declined/lapsed/
//     superseded/failed→ unavailable (message + the timetable as next step)
type FlowState = "idle" | "requesting" | "pending" | "paying" | "unavailable";

export function ImmediateBookButton({
  practitionerId,
  serviceId,
  onSeeOtherTimes,
}: {
  practitionerId: string;
  serviceId: string;
  // Expands this service's SlotPicker in the parent — „Виж други часове" (idle)
  // and „Виж свободните часове" (after an unavailable outcome) both call it.
  onSeeOtherTimes: () => void;
}) {
  const t = useTranslations("Immediate");
  const locale = useLocale();
  const router = useRouter();

  const [state, setState] = useState<FlowState>("idle");
  const [requestId, setRequestId] = useState<string | null>(null);
  const [expiresAt, setExpiresAt] = useState<string | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());

  async function handleBook() {
    setState("requesting");
    try {
      const res = await createImmediateRequest(practitionerId, serviceId);
      if (!res.ok) {
        setState("unavailable");
        return;
      }
      setRequestId(res.requestId);
      setExpiresAt(res.expiresAt);
      setState("pending");
    } catch {
      setState("unavailable");
    }
  }

  // Poll while pending; resolve the branch the instant the request leaves
  // 'pending'. A ref guards the one-shot payment handoff so a late poll can't
  // fire startImmediatePayment twice.
  const resolvingRef = useRef(false);
  useEffect(() => {
    if (state !== "pending" || !requestId) return;
    let active = true;

    const resolve = async (status: string) => {
      if (resolvingRef.current) return;
      if (status === "pending") return;
      resolvingRef.current = true;
      if (status === "confirmed") {
        setState("paying");
        const pay = await startImmediatePayment(requestId, locale);
        if (pay.ok) {
          window.location.href = pay.url; // external — Stripe Checkout
        } else if (active) {
          setState("unavailable");
        }
        return;
      }
      if (status === "booked") {
        // software_provider booked on confirm — no payment; the confirmation
        // page polls for the booking and offers Join.
        router.push(`/immediate/${requestId}`);
        return;
      }
      if (active) setState("unavailable"); // declined / lapsed / superseded / payment_failed
    };

    const poll = async () => {
      try {
        const res = await getImmediateRequestStatus(requestId);
        if (active) void resolve(res.status);
      } catch {
        /* transient — keep polling until it resolves or lapses server-side */
      }
    };
    void poll();
    const id = setInterval(poll, IMMEDIATE_CONFIG.CLIENT_POLL_MS);
    return () => {
      active = false;
      clearInterval(id);
    };
  }, [state, requestId, locale, router]);

  // Countdown ticker, only while pending.
  useEffect(() => {
    if (state !== "pending") return;
    const id = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(id);
  }, [state]);

  const remaining = expiresAt ? Math.max(0, Math.round((new Date(expiresAt).getTime() - nowMs) / 1000)) : 0;

  if (state === "unavailable") {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
        <p style={{ margin: 0, font: "var(--text-body-sm)", color: "var(--text-secondary)" }}>{t("notAvailableWithTimes")}</p>
        <Button type="button" variant="secondary" onClick={onSeeOtherTimes}>
          {t("seeAvailableTimes")}
        </Button>
      </div>
    );
  }

  if (state === "pending" || state === "requesting" || state === "paying") {
    const message =
      state === "requesting" ? t("requesting") : state === "paying" ? t("redirectingToPayment") : t("waiting", { seconds: remaining });
    return (
      <div
        role="status"
        aria-live="polite"
        style={{
          display: "flex",
          alignItems: "center",
          gap: "var(--space-2)",
          font: "var(--text-body-sm)",
          color: "var(--text-secondary)",
          padding: "var(--space-3)",
          background: "var(--accent-subtle)",
          borderRadius: "var(--radius-md)",
        }}
      >
        <span
          aria-hidden="true"
          style={{ width: 8, height: 8, borderRadius: "50%", background: "var(--accent)", flexShrink: 0 }}
        />
        {message}
      </div>
    );
  }

  // idle — the two actions. „Резервирай сега" (gold primary) never disappears
  // when the timetable is expanded; „Виж други часове" just reveals the grid.
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--space-2)" }}>
      <Button type="button" variant="primary" onClick={handleBook}>
        {t("bookNow")}
      </Button>
      <Button type="button" variant="secondary" onClick={onSeeOtherTimes}>
        {t("seeOtherTimes")}
      </Button>
    </div>
  );
}
