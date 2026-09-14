"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { approveRefundRequest, denyRefundRequest, type RefundReviewState } from "@/app/[locale]/admin/refunds/actions";

type Labels = { approve: string; deny: string; reasonPlaceholder: string; reasonRequired: string; noPayment: string; refundFailed: string; notPending: string };

function Btn({ label, tone }: { label: string; tone: "approve" | "deny" }) {
  const { pending } = useFormStatus();
  const isApprove = tone === "approve";
  return (
    <button type="submit" disabled={pending} style={{ font: "var(--text-label)", fontWeight: 600, color: isApprove ? "var(--text-on-accent)" : "var(--color-danger)", background: isApprove ? "var(--color-success)" : "transparent", border: isApprove ? "none" : "1px solid var(--color-danger)", borderRadius: "var(--radius-md)", padding: "var(--space-2) var(--space-5)", cursor: pending ? "default" : "pointer", opacity: pending ? 0.7 : 1 }}>
      {label}
    </button>
  );
}

function err(state: RefundReviewState, l: Labels): string | null {
  if (!state?.error) return null;
  if (state.error === "REASON_REQUIRED") return l.reasonRequired;
  if (state.error === "NO_PAYMENT") return l.noPayment;
  if (state.error === "REFUND_FAILED") return l.refundFailed;
  return l.notPending;
}

export function RefundReviewControls({ requestId, labels }: { requestId: string; labels: Labels }) {
  const [appState, appAction] = useActionState<RefundReviewState, FormData>((p) => approveRefundRequest(requestId, p), null);
  const [denyState, denyAction] = useActionState<RefundReviewState, FormData>((p, fd) => denyRefundRequest(requestId, p, fd), null);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)", marginTop: "var(--space-2)", borderTop: "1px solid var(--border-subtle)", paddingTop: "var(--space-3)" }}>
      <form action={denyAction} style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
        <textarea name="reason" rows={2} placeholder={labels.reasonPlaceholder} style={{ font: "var(--text-body-sm)", padding: "var(--space-2) var(--space-3)", borderRadius: "var(--radius-md)", border: "1px solid var(--border-default)", background: "var(--bg-surface)", color: "var(--text-primary)", resize: "vertical" }} />
        <div style={{ display: "flex", gap: "var(--space-3)", alignItems: "center", flexWrap: "wrap" }}>
          <Btn label={labels.deny} tone="deny" />
          {err(denyState, labels) && <span style={{ font: "var(--text-body-sm)", color: "var(--color-danger)" }}>{err(denyState, labels)}</span>}
        </div>
      </form>
      <form action={appAction} style={{ display: "flex", gap: "var(--space-3)", alignItems: "center", flexWrap: "wrap" }}>
        <Btn label={labels.approve} tone="approve" />
        {err(appState, labels) && <span style={{ font: "var(--text-body-sm)", color: "var(--color-danger)" }}>{err(appState, labels)}</span>}
      </form>
    </div>
  );
}
