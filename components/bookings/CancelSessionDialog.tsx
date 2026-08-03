"use client";

import { useRef } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/Button";
import { DialogFormActions } from "@/components/ui/DialogFormActions";

// Mirrors the server actions' own MAX_NOTE_LENGTH — this is just the
// UX-level constraint (stops typing early); the server copy is what
// actually bounds what ends up in an email.
const MAX_NOTE_LENGTH = 500;

// Shared by both dashboards. A native <dialog> via showModal(), not a
// custom overlay component: the browser handles focus trapping, moves
// focus in on open and restores it on close, and Escape dismisses it —
// everything "focus-managed and dismissible" needs, for free.
//
// The practitioner and client variants genuinely differ, not just in
// wording: a practitioner can cancel any of their own upcoming sessions
// at any time and may attach an optional note (emailed to the client);
// a client is only ever offered this dialog once the caller (BookingsList)
// has already confirmed they're outside the practitioner's notice
// window, and has nothing to attach — cancel-booking-actions.ts's
// client path doesn't accept/store a note today, so showing that field
// here would silently discard whatever the client typed.
export function CancelSessionDialog({
  counterpartName,
  sessionTimeLabel,
  perspective,
  action,
}: {
  counterpartName: string;
  sessionTimeLabel: string;
  perspective: "practitioner" | "client";
  // Already bound to its bookingId (and, for the client variant, its
  // timezone) by the caller — see cancelBookingAsPractitioner/
  // cancelBookingAsClient's own .bind(null, ...) call sites.
  action: (formData: FormData) => void | Promise<void>;
}) {
  const t = useTranslations("Booking");
  const dialogRef = useRef<HTMLDialogElement>(null);

  const dialogTitle =
    perspective === "practitioner"
      ? t("cancelDialogTitle", { client: counterpartName, time: sessionTimeLabel })
      : t("cancelDialogTitleClient", { practitioner: counterpartName, time: sessionTimeLabel });

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
        <form action={action} style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
          <p style={{ margin: 0, font: "var(--text-body-md)" }}>{dialogTitle}</p>
          {perspective === "practitioner" && (
            <label>
              {t("cancelNoteLabel")}
              <textarea name="note" rows={3} maxLength={MAX_NOTE_LENGTH} className="form-field" style={{ width: "100%" }} />
            </label>
          )}
          <DialogFormActions
            cancelLabel={t("cancelDialogDismiss")}
            confirmLabel={t("cancelDialogConfirm")}
            confirmPendingLabel={t("cancelDialogPending")}
            onCancel={() => dialogRef.current?.close()}
          />
        </form>
      </dialog>
    </>
  );
}
