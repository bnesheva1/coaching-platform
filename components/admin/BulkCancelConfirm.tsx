"use client";

import { useState, useActionState } from "react";
import { useTranslations, useLocale } from "next-intl";
import { runBulkCancel, type BulkCancelActionState } from "@/app/[locale]/admin/practitioners/bulk-cancel-actions";
import type { BulkCancelPreview } from "@/lib/admin/bulkCancel";
import { Button } from "@/components/ui/Button";

const OUTCOME_COLOR: Record<string, string> = {
  refunded: "var(--color-success)",
  refund_failed: "var(--color-danger)",
  no_payment: "var(--text-tertiary)",
  already_refunded: "var(--text-tertiary)",
};

const INTL_LOCALES: Record<string, string> = { bg: "bg-BG", en: "en-US" };

export function BulkCancelConfirm({
  practitionerId,
  username,
  preview,
}: {
  practitionerId: string;
  username: string;
  preview: BulkCancelPreview;
}) {
  const t = useTranslations("Admin");
  const locale = useLocale();
  const intl = INTL_LOCALES[locale] ?? "en-US";
  const dateFmt = new Intl.DateTimeFormat(intl, { dateStyle: "medium", timeStyle: "short" });
  const money = (cents: number, currency: string) => new Intl.NumberFormat(intl, { style: "currency", currency }).format(cents / 100);
  const cur = preview.currency ?? "EUR";

  const [state, formAction, isPending] = useActionState<BulkCancelActionState, FormData>(
    runBulkCancel.bind(null, practitionerId, username),
    null,
  );
  const [typed, setTyped] = useState("");
  const [reason, setReason] = useState("");

  const result = state && "result" in state ? state.result : null;
  const error = state && "error" in state ? state.error : null;

  // Report — checked FIRST, so it survives the server re-render that empties the
  // preview after a successful run.
  if (result) {
    return (
      <section style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
        <h2 style={{ font: "var(--text-heading-sm)", margin: 0 }}>{t("bulkReportHeading")}</h2>
        <p style={{ margin: 0, font: "var(--text-body-md)" }}>
          {t("bulkReportSummary", {
            refunded: result.counts.refunded,
            failed: result.counts.refundFailed,
            noPayment: result.counts.noPayment + result.counts.alreadyRefunded,
          })}
        </p>
        {!result.complete && <p style={{ margin: 0, font: "var(--text-body-sm)", color: "var(--color-warning)" }}>{t("bulkReportIncomplete")}</p>}
        {result.counts.refundFailed > 0 && <p style={{ margin: 0, font: "var(--text-body-sm)", color: "var(--color-danger)" }}>{t("bulkReportFailedNote")}</p>}
        <div style={{ display: "flex", flexDirection: "column" }}>
          {result.outcomes.map((o) => (
            <div key={o.bookingId} style={{ display: "flex", justifyContent: "space-between", gap: "var(--space-3)", font: "var(--text-body-sm)", borderBottom: "1px solid var(--border-subtle)", padding: "var(--space-1) 0" }}>
              <span>{o.clientName}</span>
              <span style={{ color: OUTCOME_COLOR[o.outcome] ?? "var(--text-secondary)", whiteSpace: "nowrap" }}>
                {t(`bulkOutcome_${o.outcome}` as Parameters<typeof t>[0])}
              </span>
            </div>
          ))}
        </div>
      </section>
    );
  }

  if (preview.count === 0) {
    return <p style={{ font: "var(--text-body-md)", color: "var(--text-secondary)" }}>{t("bulkNone")}</p>;
  }

  const canSubmit = typed.trim() === username && reason.trim().length > 0 && !isPending;
  const cellStyle = { padding: "var(--space-2) var(--space-3)", borderBottom: "1px solid var(--border-subtle)", textAlign: "left" as const, font: "var(--text-body-sm)" };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-6)" }}>
      {/* Preview — exactly what will happen, before anything runs. */}
      <section>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--space-1) var(--space-6)", marginBottom: "var(--space-3)", font: "var(--text-body-md)" }}>
          <span><strong>{preview.count}</strong> {t("bulkBookings")}</span>
          <span><strong>{money(preview.totalRefundableCents, cur)}</strong> {t("bulkToRefund")}</span>
          {preview.noPaymentCount > 0 && <span style={{ color: "var(--text-tertiary)" }}>{t("bulkNoPaymentCount", { count: preview.noPaymentCount })}</span>}
        </div>
        <div style={{ overflowX: "auto" }}>
          <table style={{ borderCollapse: "collapse", width: "100%", minWidth: 520 }}>
            <thead>
              <tr>
                <th style={cellStyle}>{t("bulkColClient")}</th>
                <th style={cellStyle}>{t("bulkColWhen")}</th>
                <th style={cellStyle}>{t("bulkColAmount")}</th>
              </tr>
            </thead>
            <tbody>
              {preview.bookings.map((b) => (
                <tr key={b.bookingId}>
                  <td style={cellStyle}>{b.clientName}</td>
                  <td style={{ ...cellStyle, whiteSpace: "nowrap" }}>{dateFmt.format(new Date(b.startUtc))}</td>
                  <td style={cellStyle}>
                    {b.amountCents == null ? t("bulkNoPayment") : b.alreadyRefunded ? t("bulkAlreadyRefunded") : money(b.amountCents, b.currency ?? cur)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Confirm — reason + type the username. */}
      <form action={formAction} style={{ maxWidth: 520 }}>
        <div style={{ border: "1px solid var(--color-danger)", borderRadius: "var(--radius-md)", padding: "var(--space-4)", display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
          <p style={{ margin: 0, font: "var(--text-body-md)", color: "var(--color-danger)", fontWeight: 600 }}>{t("bulkWarning")}</p>

          <label style={{ display: "flex", flexDirection: "column", gap: "var(--space-1)" }}>
            <span style={{ font: "var(--text-body-sm)", fontWeight: 600 }}>{t("bulkReasonLabel")}</span>
            <textarea name="reason" required rows={2} value={reason} onChange={(e) => setReason(e.target.value)} className="form-field" placeholder={t("bulkReasonPlaceholder")} style={{ width: "100%", resize: "vertical" }} />
          </label>

          <label style={{ display: "flex", flexDirection: "column", gap: "var(--space-1)" }}>
            <span style={{ font: "var(--text-body-sm)", fontWeight: 600 }}>{t("bulkTypeToConfirm", { username })}</span>
            <input name="confirmUsername" value={typed} onChange={(e) => setTyped(e.target.value)} className="form-field" autoComplete="off" style={{ width: "100%" }} />
          </label>

          {error && <p style={{ margin: 0, font: "var(--text-body-sm)", color: "var(--color-danger)" }}>{t(`bulkError_${error}` as Parameters<typeof t>[0])}</p>}

          <Button type="submit" disabled={!canSubmit}>
            {isPending ? t("bulkRunning") : t("bulkConfirm")}
          </Button>
        </div>
      </form>
    </div>
  );
}
