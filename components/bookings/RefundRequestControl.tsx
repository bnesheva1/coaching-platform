"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { useTranslations } from "next-intl";
import { submitRefundRequest, type RefundRequestState } from "@/app/[locale]/client-dashboard/refund-request-actions";

type Existing = { status: "pending" | "approved" | "denied"; denialReason: string | null } | null | undefined;

function SubmitBtn({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      style={{ font: "var(--text-label)", fontWeight: 600, color: "var(--text-on-accent)", background: "var(--accent)", border: "none", borderRadius: "var(--radius-md)", padding: "var(--space-2) var(--space-4)", cursor: pending ? "default" : "pointer", opacity: pending ? 0.7 : 1 }}
    >
      {label}
    </button>
  );
}

// Client-facing, per past session. Shows the existing request's status
// (pending / approved / denied + reason) if one exists; otherwise a compact
// disclosure with the request form (reason type + free text for "other").
export function RefundRequestControl({ bookingId, existing }: { bookingId: string; existing: Existing }) {
  const t = useTranslations("RefundRequest");
  const [state, formAction] = useActionState<RefundRequestState, FormData>(
    (prev, formData) => submitRefundRequest(bookingId, prev, formData),
    null,
  );

  if (existing) {
    const color = existing.status === "approved" ? "var(--color-success)" : existing.status === "denied" ? "var(--color-danger)" : "var(--text-secondary)";
    return (
      <div style={{ marginTop: "var(--space-2)", font: "var(--text-body-sm)" }}>
        <span style={{ color, fontWeight: 600 }}>{t(`status_${existing.status}` as "status_pending")}</span>
        {existing.status === "denied" && existing.denialReason && (
          <span style={{ color: "var(--text-secondary)" }}> — {existing.denialReason}</span>
        )}
      </div>
    );
  }
  // Already submitted this render cycle (before revalidation catches up).
  if (state?.success) {
    return <div style={{ marginTop: "var(--space-2)", font: "var(--text-body-sm)", color: "var(--text-secondary)", fontWeight: 600 }}>{t("status_pending")}</div>;
  }

  return (
    <details style={{ marginTop: "var(--space-2)" }}>
      <summary style={{ font: "var(--text-body-sm)", color: "var(--accent)", cursor: "pointer" }}>{t("requestCta")}</summary>
      <form action={formAction} style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)", marginTop: "var(--space-2)", maxWidth: 420 }}>
        <label style={{ font: "var(--text-body-sm)", display: "flex", gap: "var(--space-2)", alignItems: "center" }}>
          <input type="radio" name="reasonType" value="technical_failure" defaultChecked /> {t("reasonTechnical")}
        </label>
        <label style={{ font: "var(--text-body-sm)", display: "flex", gap: "var(--space-2)", alignItems: "center" }}>
          <input type="radio" name="reasonType" value="other" /> {t("reasonOther")}
        </label>
        <textarea
          name="reasonText"
          rows={2}
          placeholder={t("descriptionPlaceholder")}
          className="form-field"
          style={{ resize: "vertical", font: "var(--text-body-sm)" }}
        />
        <div style={{ display: "flex", gap: "var(--space-3)", alignItems: "center" }}>
          <SubmitBtn label={t("submit")} />
          {state?.error && <span style={{ font: "var(--text-body-sm)", color: "var(--color-danger)" }}>{state.error}</span>}
        </div>
      </form>
    </details>
  );
}
