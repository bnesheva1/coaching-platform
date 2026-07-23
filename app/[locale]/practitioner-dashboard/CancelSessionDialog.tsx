"use client";

import { useRef } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/Button";
import { cancelBookingAsPractitioner } from "./cancel-booking-actions";

// Mirrors cancel-booking-actions.ts's own MAX_NOTE_LENGTH — this is
// just the UX-level constraint (stops typing early); the server copy is
// what actually bounds what can end up in an email.
const MAX_NOTE_LENGTH = 500;

// Replaces the old CancelBookingButton's native confirm() — a plain
// confirm() can't hold a text field, and cancelling a real client's
// session deserves more than a single yes/no anyway. A native <dialog>
// via showModal(), not a custom overlay component: the browser handles
// focus trapping, moves focus in on open and restores it on close, and
// Escape dismisses it — everything "focus-managed and dismissible"
// needs, for free.
export function CancelSessionDialog({
  bookingId,
  clientName,
  sessionTimeLabel,
}: {
  bookingId: string;
  clientName: string;
  sessionTimeLabel: string;
}) {
  const t = useTranslations("Booking");
  const dialogRef = useRef<HTMLDialogElement>(null);

  return (
    <>
      <Button type="button" variant="secondary" size="sm" onClick={() => dialogRef.current?.showModal()}>
        {t("cancelButton")}
      </Button>
      <dialog
        ref={dialogRef}
        onClick={(e) => {
          // A click landing directly on the <dialog> element itself
          // (never a descendant, since the form fills it) means the
          // backdrop was clicked — the browser has no dedicated event
          // for that.
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
        <form
          action={cancelBookingAsPractitioner.bind(null, bookingId)}
          style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}
        >
          <p style={{ margin: 0, font: "var(--text-body-md)" }}>
            {t("cancelDialogTitle", { client: clientName, time: sessionTimeLabel })}
          </p>
          <label>
            {t("cancelNoteLabel")}
            <textarea name="note" rows={3} maxLength={MAX_NOTE_LENGTH} className="form-field" style={{ width: "100%" }} />
          </label>
          <div style={{ display: "flex", gap: "var(--space-2)", justifyContent: "flex-end" }}>
            <Button type="button" variant="ghost" size="sm" onClick={() => dialogRef.current?.close()}>
              {t("cancelDialogDismiss")}
            </Button>
            <Button type="submit" size="sm">
              {t("cancelDialogConfirm")}
            </Button>
          </div>
        </form>
      </dialog>
    </>
  );
}
