"use client";

import { useEffect, useRef } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/Button";

type Outcome = "success" | "error" | "processing" | "cancelled";

// The outcome of whatever booking attempt redirected the client back to
// this page — previously a plain inline banner sitting at the top of
// the (possibly long, possibly scrolled-past) services section, easy to
// miss entirely. Same dismissible-dialog recipe as SlotPicker's own
// login-prompt dialog (floating ✕, title, body, one button) — opens
// itself on mount via showModal(), not on every render, so it can only
// ever appear once per page load, and only for the outcome the URL this
// page was loaded with actually carries. Requires an explicit close
// (click the button, the ✕, the backdrop, or Escape) rather than
// auto-dismissing, matching every other dialog in this app.
export function BookingResultDialog({
  justBooked,
  bookingErrorCode,
  paymentStatus,
}: {
  justBooked: boolean;
  bookingErrorCode: string | null;
  paymentStatus: "processing" | "cancelled" | null;
}) {
  const t = useTranslations("Booking");
  const dialogRef = useRef<HTMLDialogElement>(null);

  // At most one of these is ever true for a given page load — all four
  // come from the same redirect, which only ever carries one outcome.
  const outcome: Outcome | null = justBooked
    ? "success"
    : bookingErrorCode
      ? "error"
      : paymentStatus === "processing"
        ? "processing"
        : paymentStatus === "cancelled"
          ? "cancelled"
          : null;

  useEffect(() => {
    if (outcome) dialogRef.current?.showModal();
    // Deliberately mount-only — outcome is derived from props that are
    // themselves derived from the URL this page loaded with, not live
    // state, so nothing should ever re-trigger this after the first
    // render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!outcome) return null;

  const titleColor = outcome === "success" ? "green" : outcome === "error" ? "crimson" : "var(--text-primary)";
  const title =
    outcome === "success"
      ? t("resultConfirmedTitle")
      : outcome === "error"
        ? t("resultFailedTitle")
        : outcome === "processing"
          ? t("resultProcessingTitle")
          : t("resultCancelledTitle");
  const body =
    outcome === "success"
      ? t("resultConfirmedBody")
      : outcome === "error"
        ? // Same per-code-with-fallback lookup the old inline banner used.
          (bookingErrorCode && t.has(bookingErrorCode) ? t(bookingErrorCode as Parameters<typeof t>[0]) : t("bookingFailed"))
        : outcome === "processing"
          ? t("paymentProcessing")
          : t("paymentCancelled");

  return (
    <dialog
      ref={dialogRef}
      onClick={(e) => {
        if (e.target === dialogRef.current) dialogRef.current?.close();
      }}
      style={{
        border: "none",
        borderRadius: "var(--radius-lg)",
        padding: "var(--space-6)",
        maxWidth: "26rem",
        width: "90vw",
        background: "var(--bg-surface)",
        color: "var(--text-primary)",
      }}
    >
      <div style={{ position: "relative", display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
        <button
          type="button"
          className="focus-ring"
          aria-label={t("resultClose")}
          onClick={() => dialogRef.current?.close()}
          style={{
            position: "absolute",
            top: "calc(var(--space-3) * -1)",
            right: "calc(var(--space-3) * -1)",
            width: 32,
            height: 32,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "none",
            border: "none",
            borderRadius: "50%",
            color: "var(--text-tertiary)",
            font: "var(--text-icon)",
            cursor: "pointer",
          }}
        >
          ✕
        </button>
        <p style={{ margin: "var(--space-6) 0 0", font: "var(--text-heading-sm)", color: titleColor }}>{title}</p>
        <p style={{ margin: 0, font: "var(--text-body-md)", color: "var(--text-secondary)" }}>{body}</p>
        <div style={{ display: "flex", justifyContent: "flex-end", marginTop: "var(--space-2)" }}>
          <Button type="button" size="sm" onClick={() => dialogRef.current?.close()}>
            {t("resultClose")}
          </Button>
        </div>
      </div>
    </dialog>
  );
}
