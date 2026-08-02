"use client";

import { useImperativeHandle, useRef } from "react";
import { Button } from "@/components/ui/Button";

export type ConfirmDialogHandle = { open: () => void };

// Same native <dialog> + showModal() pattern as CancelSessionDialog —
// the browser handles focus trapping, moves focus in on open and
// restores it on close, and Escape dismisses it for free. This is the
// generic form of that same pattern: any "are you sure?" gate in front
// of a server-action form, replacing a native confirm() call.
export function ConfirmDialog({
  ref,
  message,
  confirmLabel,
  cancelLabel,
  action,
  onCancel,
}: {
  ref: React.Ref<ConfirmDialogHandle>;
  message: string;
  confirmLabel: string;
  cancelLabel: string;
  action: (formData: FormData) => void | Promise<void>;
  // Called right before the dialog closes on Cancel — not on a
  // successful confirm, since the form submission (and whatever the
  // caller does after) already covers that case.
  onCancel?: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useImperativeHandle(ref, () => ({
    open: () => dialogRef.current?.showModal(),
  }));

  function close() {
    onCancel?.();
    dialogRef.current?.close();
  }

  return (
    <dialog
      ref={dialogRef}
      onClick={(e) => {
        // A click landing directly on the <dialog> element itself
        // (never a descendant, since the form fills it) means the
        // backdrop was clicked.
        if (e.target === dialogRef.current) close();
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
        <p style={{ margin: 0, font: "var(--text-body-md)" }}>{message}</p>
        <div style={{ display: "flex", gap: "var(--space-2)", justifyContent: "flex-end" }}>
          <Button type="button" variant="ghost" size="sm" onClick={close}>
            {cancelLabel}
          </Button>
          <Button type="submit" size="sm">
            {confirmLabel}
          </Button>
        </div>
      </form>
    </dialog>
  );
}
