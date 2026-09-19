"use client";

import { useActionState } from "react";
import { useTranslations } from "next-intl";
import { HelpCircle } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { saveBookingIntakeAnswer, type IntakeActionState } from "@/app/[locale]/bookings/intake-actions";
import type { BookingPerspective } from "./BookingsList";

const MAX_INTAKE_ANSWER = 300;
const initialState: IntakeActionState = null;

const promptStyle = { margin: "0 0 var(--space-1)", font: "var(--text-body-sm)", color: "var(--text-secondary)", whiteSpace: "pre-wrap", wordBreak: "break-word" } as const;
const answerStyle = { margin: 0, font: "var(--text-body-sm)", color: "var(--text-primary)", whiteSpace: "pre-wrap", wordBreak: "break-word" } as const;
const labelStyle = { display: "flex", alignItems: "center", gap: "var(--space-1)", margin: 0, font: "var(--text-label)", color: "var(--text-tertiary)" } as const;
const emptyStyle = { margin: 0, font: "var(--text-body-sm)", color: "var(--text-tertiary)", fontStyle: "italic" } as const;

// The intake question for a booking: the practitioner's prompt (snapshotted onto
// the booking) plus the client's optional answer. The client's side is an
// editable textarea (save/clear any time within the active window — the server
// RPC is the authoritative gate); the practitioner sees a read-only answer.
// Both prompt and answer are rendered as plain text (React auto-escaping +
// pre-wrap), never as HTML.
export function BookingIntake({
  bookingId,
  perspective,
  prompt,
  answer,
}: {
  bookingId: string;
  perspective: BookingPerspective;
  prompt: string;
  answer: string | null;
}) {
  const t = useTranslations("Intake");
  const [state, formAction, pending] = useActionState(saveBookingIntakeAnswer, initialState);

  const heading = (
    <p style={labelStyle}>
      <HelpCircle size={14} aria-hidden />
      {t("sectionHeading")}
    </p>
  );

  const wrap = { marginTop: "var(--space-3)", paddingTop: "var(--space-3)", borderTop: "1px solid var(--border-subtle)", display: "flex", flexDirection: "column", gap: "var(--space-2)" } as const;

  if (perspective === "practitioner") {
    return (
      <div style={wrap}>
        {heading}
        <p style={promptStyle}>{prompt}</p>
        {answer ? <p style={answerStyle}>{answer}</p> : <p style={emptyStyle}>{t("noAnswerYet")}</p>}
      </div>
    );
  }

  // Client side — editable. Re-key the textarea off the action result so a
  // successful save (server-normalised value) or a rejection is reflected.
  return (
    <form action={formAction} style={wrap}>
      {heading}
      <p style={promptStyle}>{prompt}</p>
      <input type="hidden" name="bookingId" value={bookingId} />
      <label style={{ display: "flex", flexDirection: "column", gap: "var(--space-1)" }}>
        <span style={{ font: "var(--text-body-sm)", color: "var(--text-secondary)" }}>{t("answerLabel")}</span>
        <textarea
          name="answer"
          rows={3}
          defaultValue={answer ?? ""}
          maxLength={MAX_INTAKE_ANSWER}
          placeholder={t("answerPlaceholder")}
          className="form-field"
          style={{ width: "100%" }}
        />
      </label>
      {state?.error && <p style={{ margin: 0, color: "var(--color-danger)", font: "var(--text-body-sm)" }}>{state.error}</p>}
      {state?.success && <p style={{ margin: 0, color: "var(--color-success)", font: "var(--text-body-sm)" }}>{t("saved")}</p>}
      <div>
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? t("saving") : t("saveAnswer")}
        </Button>
      </div>
    </form>
  );
}
