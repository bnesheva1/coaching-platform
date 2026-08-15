"use client";

import { useRef } from "react";
import { useFormStatus } from "react-dom";
import { Spinner } from "@/components/ui/Spinner";
import styles from "./FlagToggle.module.css";

// The confirm-button tone maps to how alarming the action is. Uses the same
// semantic hexes the admin page already uses for off/warning states
// (#c0392b / #a15c00), kept literal here to match rather than inventing tokens.
type Tone = "accent" | "danger" | "warning";
const TONE_BG: Record<Tone, string> = { accent: "var(--accent)", danger: "#c0392b", warning: "#a15c00" };
const TONE_TEXT: Record<Tone, string> = { accent: "var(--text-on-accent)", danger: "#fff", warning: "#fff" };

// The switch is a state MIRROR + trigger: activating it opens a confirmation,
// and the button inside that dialog is the actual server action. So a stray tap
// can't take a feature offline — it only asks. Built on the same native
// <dialog> + showModal() pattern as ConfirmDialog (browser handles focus
// trapping, Escape, and focus restore); it gets its own copy here only because
// the confirm button needs a per-direction tone the shared DialogFormActions
// doesn't offer.
export function FlagToggle({
  on,
  ariaLabel,
  action,
  tone,
  small = false,
  override = false,
  dialogTitle,
  dialogBody,
  confirmLabel,
  confirmPendingLabel,
  cancelLabel,
  immediateLabel,
  loggedLabel,
}: {
  on: boolean;
  ariaLabel: string;
  // Already bound to its (flagKey, targetState) by the caller — see the
  // setFlag.bind(null, key, !on) call sites in the admin page.
  action: (formData: FormData) => void | Promise<void>;
  tone: Tone;
  small?: boolean;
  override?: boolean;
  dialogTitle: string;
  dialogBody: string;
  confirmLabel: string;
  confirmPendingLabel: string;
  cancelLabel: string;
  immediateLabel: string;
  loggedLabel: string;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  async function handleAction(formData: FormData) {
    await action(formData);
    // The server action revalidates the page (new resolved state flows back as
    // props); close the dialog once it's committed.
    dialogRef.current?.close();
  }

  const switchClass = [styles.switch, small ? styles.small : "", override ? styles.override : ""].filter(Boolean).join(" ");

  return (
    <>
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-label={ariaLabel}
        className={switchClass}
        onClick={() => dialogRef.current?.showModal()}
      />
      <dialog
        ref={dialogRef}
        className={styles.dialog}
        onClick={(e) => {
          // A click on the <dialog> element itself (never a descendant, since
          // the form fills it) is a backdrop click.
          if (e.target === dialogRef.current) dialogRef.current?.close();
        }}
      >
        <form action={handleAction} className={styles.form}>
          <div className={styles.head}>
            <span className={styles.mark} style={{ background: TONE_BG[tone] }} aria-hidden="true" />
            <h2 className={styles.title}>{dialogTitle}</h2>
          </div>
          <p className={styles.body}>{dialogBody}</p>
          <div className={styles.meta}>
            <span>
              <span className={styles.metaDot} aria-hidden="true" />
              {immediateLabel}
            </span>
            <span>
              <span className={styles.metaDot} aria-hidden="true" />
              {loggedLabel}
            </span>
          </div>
          <DialogActions
            tone={tone}
            confirmLabel={confirmLabel}
            confirmPendingLabel={confirmPendingLabel}
            cancelLabel={cancelLabel}
            onCancel={() => dialogRef.current?.close()}
          />
        </form>
      </dialog>
    </>
  );
}

// Split out because useFormStatus only reports the enclosing <form>'s state to
// a DESCENDANT of that form — same reason DialogFormActions exists. Disables
// both buttons and swaps in a spinner while the action is in flight, so an
// impatient double-click can't fire the toggle twice.
function DialogActions({
  tone,
  confirmLabel,
  confirmPendingLabel,
  cancelLabel,
  onCancel,
}: {
  tone: Tone;
  confirmLabel: string;
  confirmPendingLabel: string;
  cancelLabel: string;
  onCancel: () => void;
}) {
  const { pending } = useFormStatus();
  return (
    <div className={styles.actions}>
      <button type="button" className={styles.cancel} onClick={onCancel} disabled={pending}>
        {cancelLabel}
      </button>
      <button
        type="submit"
        className={styles.confirm}
        style={{ background: TONE_BG[tone], color: TONE_TEXT[tone] }}
        disabled={pending}
      >
        {pending ? (
          <span className={styles.pendingWrap}>
            <Spinner size={14} />
            {confirmPendingLabel}
          </span>
        ) : (
          confirmLabel
        )}
      </button>
      <span aria-live="polite" className={styles.srOnly}>
        {pending ? confirmPendingLabel : ""}
      </span>
    </div>
  );
}
