"use client";

import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui/Button";
import { Spinner } from "@/components/ui/Spinner";

// The cancel/submit button row shared by ConfirmDialog.tsx and
// CancelSessionDialog.tsx. Pulled out into its own component (rather
// than living inline in either dialog) because useFormStatus only ever
// reports the nearest enclosing <form>'s state to a DESCENDANT of that
// form — calling it directly in ConfirmDialog/CancelSessionDialog's own
// body would always report `pending: false`, since those components
// render the <form> themselves rather than being rendered inside one.
//
// Without this, a slow server action (a DB round trip, a Stripe/rate-
// limit check, whatever) left the confirm button fully clickable for
// the entire in-flight window — nothing disabled it, nothing showed
// progress, so an impatient double-click routinely fired the action
// twice and raced itself (e.g. a booking's own confirm losing a race to
// its own retry, surfacing as "that slot was just taken").
export function DialogFormActions({
  cancelLabel,
  confirmLabel,
  // Shown instead of confirmLabel while pending, alongside the spinner.
  // Optional — falls back to confirmLabel itself, so every existing
  // caller still gets the disable+spinner fix even without adding new
  // copy, and callers that DO want tailored wording ("Booking…") can
  // opt in with one extra prop.
  confirmPendingLabel,
  onCancel,
}: {
  cancelLabel: string;
  confirmLabel: string;
  confirmPendingLabel?: string;
  onCancel: () => void;
}) {
  const { pending } = useFormStatus();

  return (
    <div style={{ display: "flex", gap: "var(--space-2)", justifyContent: "flex-end" }}>
      <Button type="button" variant="ghost" size="sm" onClick={onCancel} disabled={pending}>
        {cancelLabel}
      </Button>
      <Button type="submit" size="sm" disabled={pending}>
        {pending ? (
          <span style={{ display: "inline-flex", alignItems: "center", gap: "var(--space-2)" }}>
            <Spinner size={14} />
            {confirmPendingLabel ?? confirmLabel}
          </span>
        ) : (
          confirmLabel
        )}
      </Button>
      {/* Screen readers get the same pending/settled signal sighted
          users get from the spinner + label swap — nothing announces
          this otherwise, since a disabled button and a swapped label
          are both silent to assistive tech on their own. */}
      <span aria-live="polite" style={{ position: "absolute", width: 1, height: 1, overflow: "hidden" }}>
        {pending ? (confirmPendingLabel ?? confirmLabel) : ""}
      </span>
    </div>
  );
}
