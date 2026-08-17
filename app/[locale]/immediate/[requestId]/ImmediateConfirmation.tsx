"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/Button";
import { getImmediateBooking, cancelImmediatePayment } from "@/lib/immediate/actions";
import { IMMEDIATE_CONFIG } from "@/lib/immediate/config";

// Statuses that mean "no booking is coming" — stop polling and show the
// not-available outcome rather than spinning forever.
const NONBOOKED_TERMINAL = new Set(["payment_failed", "lapsed", "declined", "superseded"]);
// The booking is created out-of-band (the payment webhook for commission, the
// confirm action for software_provider), so we poll for it. Bounded: after this
// many polls we stop and offer a way out rather than spinning indefinitely.
const MAX_POLLS = 40;

// The landing page after Stripe Checkout (commission) or the software_provider
// book-on-confirm redirect. It absorbs the gap between payment clearing and the
// booking/room actually existing: render immediately, poll for the booking, then
// activate Join. Also the „?payment=cancelled" return path (release + a way back).
export function ImmediateConfirmation({ requestId, cancelled }: { requestId: string; cancelled: boolean }) {
  const t = useTranslations("Immediate");
  const [status, setStatus] = useState<string | null>(null);
  const [bookingId, setBookingId] = useState<string | null>(null);
  const [username, setUsername] = useState<string | null>(null);
  const [gaveUp, setGaveUp] = useState(false);

  useEffect(() => {
    let active = true;
    let polls = 0;
    let timer: ReturnType<typeof setTimeout>;

    const step = async () => {
      polls += 1;
      try {
        const res = await getImmediateBooking(requestId);
        if (!active) return;
        setStatus(res.status);
        setUsername(res.username);
        if (res.bookingId) {
          setBookingId(res.bookingId);
          return;
        }
        if (NONBOOKED_TERMINAL.has(res.status)) return;
      } catch {
        /* transient — keep polling until the booking appears or it lapses */
      }
      if (!active || cancelled) return; // cancelled needs only one read (for the back link)
      if (polls >= MAX_POLLS) {
        setGaveUp(true);
        return;
      }
      timer = setTimeout(step, IMMEDIATE_CONFIG.CLIENT_POLL_MS);
    };

    const run = async () => {
      // The client abandoned Checkout — free the practitioner immediately rather
      // than waiting out the hold, then read status once for the back link.
      if (cancelled) {
        try {
          await cancelImmediatePayment(requestId);
        } catch {
          /* best-effort — the hold also expires on its own timer */
        }
      }
      await step();
    };
    void run();
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [requestId, cancelled]);

  const backToProfile = (
    <Button href={username ? `/p/${username}` : "/browse"} variant="secondary">
      {t("backToProfile")}
    </Button>
  );

  const isUnavailable = status !== null && NONBOOKED_TERMINAL.has(status);

  let heading: string;
  let body: string;
  let actions: React.ReactNode;

  if (cancelled) {
    heading = t("paymentCancelledHeading");
    body = t("paymentCancelledBody");
    actions = backToProfile;
  } else if (bookingId) {
    heading = t("bookedHeading");
    body = t("bookedBody");
    actions = (
      <Button href={`/session/${bookingId}`} variant="primary">
        {t("joinNow")}
      </Button>
    );
  } else if (isUnavailable) {
    heading = t("immediateUnavailableHeading");
    body = t("immediateUnavailableBody");
    actions = backToProfile;
  } else {
    // Still processing — the booking hasn't appeared yet.
    heading = t("paymentProcessingHeading");
    body = gaveUp ? t("takingLonger") : t("paymentProcessingBody");
    actions = gaveUp ? backToProfile : null;
  }

  const showSpinner = !cancelled && !bookingId && !isUnavailable && !gaveUp;

  return (
    <div
      style={{
        maxWidth: 460,
        margin: "0 auto",
        background: "var(--bg-surface)",
        borderRadius: "var(--radius-xl)",
        boxShadow: "var(--shadow-md)",
        padding: "var(--space-8)",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        textAlign: "center",
        gap: "var(--space-4)",
      }}
    >
      {showSpinner && (
        <span
          aria-hidden="true"
          style={{
            width: 32,
            height: 32,
            borderRadius: "50%",
            border: "3px solid var(--accent-subtle)",
            borderTopColor: "var(--accent)",
            animation: "immediate-spin 0.8s linear infinite",
          }}
        />
      )}
      <h1 style={{ margin: 0, font: "var(--text-heading-lg)", color: "var(--text-primary)" }}>{heading}</h1>
      <p style={{ margin: 0, font: "var(--text-body-md)", color: "var(--text-secondary)" }}>{body}</p>
      {actions && <div style={{ marginTop: "var(--space-2)" }}>{actions}</div>}
      <style>{`@keyframes immediate-spin { to { transform: rotate(360deg); } } @media (prefers-reduced-motion: reduce) { [style*="immediate-spin"] { animation: none !important; } }`}</style>
    </div>
  );
}
