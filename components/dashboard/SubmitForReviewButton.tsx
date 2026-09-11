"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { submitForReview, type SubmitForReviewState } from "@/app/[locale]/practitioner-dashboard/review-actions";

function SubmitButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      style={{
        alignSelf: "flex-start",
        font: "var(--text-label)",
        fontWeight: 600,
        color: "var(--text-on-accent)",
        background: "var(--accent)",
        border: "none",
        borderRadius: "var(--radius-md)",
        padding: "var(--space-2) var(--space-5)",
        cursor: pending ? "default" : "pointer",
        opacity: pending ? 0.7 : 1,
      }}
    >
      {label}
    </button>
  );
}

// Shared by the "draft" (Submit for review) and "changes requested" (Submit
// again) banner states — same owner-scoped action, caller passes the label.
// `errorText` is the already-translated generic failure message.
export function SubmitForReviewButton({ label, errorText }: { label: string; errorText: string }) {
  const [state, formAction] = useActionState<SubmitForReviewState, FormData>(
    (prev) => submitForReview(prev),
    null,
  );
  return (
    <form action={formAction} style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
      <SubmitButton label={label} />
      {state?.error && <span style={{ font: "var(--text-body-sm)", color: "var(--color-danger)" }}>{errorText}</span>}
    </form>
  );
}
