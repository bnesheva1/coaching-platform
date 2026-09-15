"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { useTranslations } from "next-intl";
import { saveReviewReply, type ReviewReplyState } from "@/app/[locale]/practitioner-dashboard/review-reply-actions";

function SaveButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} style={{ alignSelf: "flex-start", font: "var(--text-label)", fontWeight: 600, color: "var(--text-on-accent)", background: "var(--accent)", border: "none", borderRadius: "var(--radius-md)", padding: "var(--space-2) var(--space-4)", cursor: pending ? "default" : "pointer", opacity: pending ? 0.7 : 1 }}>
      {label}
    </button>
  );
}

// The practitioner's single public reply to a review — add / view / edit (not
// threaded). Shows the required guideline near the box. RLS + the column grant
// mean the action can only ever write reply_text on the caller's own reviews.
export function ReviewReplyEditor({ reviewId, reply }: { reviewId: string; reply: string | null }) {
  const t = useTranslations("ReviewReply");
  const [editing, setEditing] = useState(false);
  const [ackedSuccess, setAckedSuccess] = useState(false);
  const [state, formAction] = useActionState<ReviewReplyState, FormData>(
    (prev, formData) => saveReviewReply(reviewId, prev, formData),
    null,
  );
  // A successful save revalidates the page (fresh `reply` prop) — drop out of
  // edit mode so the reply view shows. Adjusting state during render (rather
  // than in an effect) is React's recommended pattern for "reset on prop/state
  // change" and re-renders synchronously before paint.
  if (state?.success && !ackedSuccess) {
    setAckedSuccess(true);
    if (editing) setEditing(false);
  } else if (!state?.success && ackedSuccess) {
    setAckedSuccess(false);
  }

  if (reply && !editing) {
    return (
      <div style={{ marginTop: "var(--space-3)", borderTop: "1px solid var(--border-subtle)", paddingTop: "var(--space-3)" }}>
        <p style={{ margin: 0, font: "var(--text-body-sm)", fontWeight: 600 }}>{t("yourReplyLabel")}</p>
        <p style={{ margin: "var(--space-1) 0 0", font: "var(--text-body-md)", color: "var(--text-secondary)", whiteSpace: "pre-wrap" }}>{reply}</p>
        <button onClick={() => setEditing(true)} style={{ marginTop: "var(--space-2)", font: "var(--text-body-sm)", color: "var(--accent)", background: "none", border: "none", padding: 0, cursor: "pointer" }}>
          {t("editCta")}
        </button>
      </div>
    );
  }

  return (
    <form action={formAction} style={{ marginTop: "var(--space-3)", borderTop: "1px solid var(--border-subtle)", paddingTop: "var(--space-3)", display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
      <label style={{ font: "var(--text-body-sm)", fontWeight: 600 }} htmlFor={`reply-${reviewId}`}>{t("replyCta")}</label>
      <textarea
        id={`reply-${reviewId}`}
        name="replyText"
        defaultValue={reply ?? ""}
        rows={3}
        maxLength={2000}
        placeholder={t("placeholder")}
        className="form-field"
        style={{ resize: "vertical", font: "var(--text-body-sm)" }}
      />
      {/* Required guideline near the reply box. */}
      <p style={{ margin: 0, font: "var(--text-body-sm)", color: "var(--text-tertiary)" }}>{t("guideline")}</p>
      <div style={{ display: "flex", gap: "var(--space-3)", alignItems: "center", flexWrap: "wrap" }}>
        <SaveButton label={t("save")} />
        {reply && (
          <button type="button" onClick={() => setEditing(false)} style={{ font: "var(--text-body-sm)", color: "var(--text-secondary)", background: "none", border: "none", cursor: "pointer" }}>
            {t("cancel")}
          </button>
        )}
        {state?.error && <span style={{ font: "var(--text-body-sm)", color: "var(--color-danger)" }}>{state.error}</span>}
      </div>
    </form>
  );
}
