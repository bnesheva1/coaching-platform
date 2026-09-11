"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { approveProfile, rejectProfile, type ReviewActionState } from "@/app/[locale]/admin/review/actions";

type Labels = {
  approve: string;
  reject: string;
  reasonPlaceholder: string;
  reasonRequired: string;
  genericError: string;
};

function ActionButton({ label, tone }: { label: string; tone: "approve" | "reject" }) {
  const { pending } = useFormStatus();
  const isApprove = tone === "approve";
  return (
    <button
      type="submit"
      disabled={pending}
      style={{
        font: "var(--text-label)",
        fontWeight: 600,
        color: isApprove ? "var(--text-on-accent)" : "var(--color-danger)",
        background: isApprove ? "var(--color-success)" : "transparent",
        border: isApprove ? "none" : "1px solid var(--color-danger)",
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

function errText(state: ReviewActionState, labels: Labels): string | null {
  if (!state?.error) return null;
  if (state.error === "REASON_REQUIRED") return labels.reasonRequired;
  return labels.genericError; // NOT_PENDING (stale queue) or anything else
}

// Approve (one click) + Reject (requires a free-text reason). Both call the
// admin review server actions; the queue revalidates on success so the actioned
// profile drops off the list.
export function ReviewControls({ practitionerId, labels }: { practitionerId: string; labels: Labels }) {
  const [approveState, approveAction] = useActionState<ReviewActionState, FormData>(
    (prev) => approveProfile(practitionerId, prev),
    null,
  );
  const [rejectState, rejectAction] = useActionState<ReviewActionState, FormData>(
    (prev, formData) => rejectProfile(practitionerId, prev, formData),
    null,
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)", marginTop: "var(--space-2)", borderTop: "1px solid var(--border-subtle)", paddingTop: "var(--space-3)" }}>
      <form action={rejectAction} style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
        <textarea
          name="reason"
          rows={2}
          placeholder={labels.reasonPlaceholder}
          style={{
            font: "var(--text-body-sm)",
            padding: "var(--space-2) var(--space-3)",
            borderRadius: "var(--radius-md)",
            border: "1px solid var(--border-default)",
            background: "var(--bg-surface)",
            color: "var(--text-primary)",
            resize: "vertical",
          }}
        />
        <div style={{ display: "flex", gap: "var(--space-3)", alignItems: "center", flexWrap: "wrap" }}>
          <ActionButton label={labels.reject} tone="reject" />
          {errText(rejectState, labels) && (
            <span style={{ font: "var(--text-body-sm)", color: "var(--color-danger)" }}>{errText(rejectState, labels)}</span>
          )}
        </div>
      </form>

      <form action={approveAction} style={{ display: "flex", gap: "var(--space-3)", alignItems: "center", flexWrap: "wrap" }}>
        <ActionButton label={labels.approve} tone="approve" />
        {errText(approveState, labels) && (
          <span style={{ font: "var(--text-body-sm)", color: "var(--color-danger)" }}>{errText(approveState, labels)}</span>
        )}
      </form>
    </div>
  );
}
