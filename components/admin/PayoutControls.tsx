"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { releasePayoutNow, extendPayoutHold, type PayoutActionState } from "@/app/[locale]/admin/payouts/actions";

type Labels = {
  releaseNow: string;
  extendHold: string;
  days: string;
  frozen: string;
  transferFailed: string;
  notReleasable: string;
  invalidDays: string;
};

function Submit({ label, tone }: { label: string; tone: "release" | "extend" }) {
  const { pending } = useFormStatus();
  const isRelease = tone === "release";
  return (
    <button
      type="submit"
      disabled={pending}
      style={{
        font: "var(--text-label)",
        fontWeight: 600,
        color: isRelease ? "var(--text-on-accent)" : "var(--text-secondary)",
        background: isRelease ? "var(--color-success)" : "transparent",
        border: isRelease ? "none" : "1px solid var(--border-default)",
        borderRadius: "var(--radius-md)",
        padding: "var(--space-2) var(--space-4)",
        cursor: pending ? "default" : "pointer",
        opacity: pending ? 0.7 : 1,
      }}
    >
      {label}
    </button>
  );
}

function err(state: PayoutActionState, l: Labels): string | null {
  if (!state?.error) return null;
  if (state.error === "FROZEN") return l.frozen;
  if (state.error === "TRANSFER_FAILED") return l.transferFailed;
  if (state.error === "INVALID_DAYS") return l.invalidDays;
  return l.notReleasable;
}

export function PayoutControls({ bookingId, labels }: { bookingId: string; labels: Labels }) {
  const [relState, relAction] = useActionState<PayoutActionState, FormData>((p) => releasePayoutNow(bookingId, p), null);
  const [extState, extAction] = useActionState<PayoutActionState, FormData>((p, fd) => extendPayoutHold(bookingId, p, fd), null);

  return (
    <div style={{ display: "flex", gap: "var(--space-4)", alignItems: "center", flexWrap: "wrap", marginTop: "var(--space-2)" }}>
      <form action={relAction} style={{ display: "flex", gap: "var(--space-2)", alignItems: "center" }}>
        <Submit label={labels.releaseNow} tone="release" />
        {err(relState, labels) && <span style={{ font: "var(--text-body-sm)", color: "var(--color-danger)" }}>{err(relState, labels)}</span>}
      </form>
      <form action={extAction} style={{ display: "flex", gap: "var(--space-2)", alignItems: "center" }}>
        <input
          type="number"
          name="days"
          min={1}
          defaultValue={7}
          aria-label={labels.days}
          style={{ width: 64, font: "var(--text-body-sm)", padding: "var(--space-1) var(--space-2)", borderRadius: "var(--radius-md)", border: "1px solid var(--border-default)", background: "var(--bg-surface)", color: "var(--text-primary)" }}
        />
        <Submit label={labels.extendHold} tone="extend" />
        {err(extState, labels) && <span style={{ font: "var(--text-body-sm)", color: "var(--color-danger)" }}>{err(extState, labels)}</span>}
      </form>
    </div>
  );
}
