"use client";

import { useRef, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { setModeration, setPayoutsFreeze, setCommissionOverride } from "@/app/[locale]/admin/practitioners/actions";
import { Button } from "@/components/ui/Button";

// A fraction (0.15) → a clean percent string ("15", "7.5"), no float noise.
const fmtPct = (rate: number) => `${+(rate * 100).toFixed(4)}`;

type ModStatus = "active" | "hidden" | "bookings_frozen" | "suspended";
const MOD_TARGETS: ModStatus[] = ["hidden", "bookings_frozen", "suspended", "active"];

const STATUS_COLOR: Record<ModStatus, string> = {
  active: "var(--text-secondary)",
  hidden: "#a15c00",
  bookings_frozen: "#a15c00",
  suspended: "#c0392b",
};

const dialogStyle = {
  border: "none",
  borderRadius: "var(--radius-lg)",
  padding: "var(--space-6)",
  maxWidth: "28rem",
  width: "90vw",
  background: "var(--bg-surface)",
  color: "var(--text-primary)",
} as const;

export function PractitionerControls({
  practitionerId,
  name,
  moderationStatus,
  payoutsFrozen,
  // Commission: the per-practitioner override (fraction, null = brand
  // default), its recorded reason + when, and the brand default (fraction)
  // to show/compare against.
  commissionOverride,
  commissionReason,
  commissionSetOn,
  brandDefaultRate,
}: {
  practitionerId: string;
  name: string;
  moderationStatus: ModStatus;
  payoutsFrozen: boolean;
  commissionOverride: number | null;
  commissionReason: string | null;
  commissionSetOn: string | null;
  brandDefaultRate: number;
}) {
  const t = useTranslations("Admin");
  const modRef = useRef<HTMLDialogElement>(null);
  const payRef = useRef<HTMLDialogElement>(null);
  const commRef = useRef<HTMLDialogElement>(null);
  const [pendingStatus, setPendingStatus] = useState<ModStatus>("hidden");
  const [pendingFrozen, setPendingFrozen] = useState<boolean>(true);
  const [modError, setModError] = useState<string | null>(null);
  const [payError, setPayError] = useState<string | null>(null);
  const [commError, setCommError] = useState<string | null>(null);
  const [busy, startTransition] = useTransition();

  const effectiveRate = commissionOverride ?? brandDefaultRate;

  const errorText = (code: string) => t(`practError_${code}` as Parameters<typeof t>[0]);

  function openMod(status: ModStatus) {
    setPendingStatus(status);
    setModError(null);
    modRef.current?.showModal();
  }
  function openPay(frozen: boolean) {
    setPendingFrozen(frozen);
    setPayError(null);
    payRef.current?.showModal();
  }

  function submitMod(formData: FormData) {
    startTransition(async () => {
      const res = await setModeration(practitionerId, null, formData);
      if (res?.error) setModError(res.error);
      else modRef.current?.close();
    });
  }
  function submitPay(formData: FormData) {
    startTransition(async () => {
      const res = await setPayoutsFreeze(practitionerId, null, formData);
      if (res?.error) setPayError(res.error);
      else payRef.current?.close();
    });
  }
  function openComm() {
    setCommError(null);
    commRef.current?.showModal();
  }
  function submitComm(formData: FormData) {
    startTransition(async () => {
      const res = await setCommissionOverride(practitionerId, null, formData);
      if (res?.error) setCommError(res.error);
      else commRef.current?.close();
    });
  }

  const chip = (label: string, color: string) => (
    <span
      style={{
        font: "var(--text-label)",
        textTransform: "uppercase",
        letterSpacing: "0.06em",
        color,
        whiteSpace: "nowrap",
      }}
    >
      {label}
    </span>
  );

  const reasonField = (
    <label style={{ display: "flex", flexDirection: "column", gap: "var(--space-1)" }}>
      <span style={{ font: "var(--text-body-sm)", fontWeight: 600 }}>{t("practReasonLabel")}</span>
      <textarea
        name="reason"
        required
        rows={3}
        className="form-field"
        placeholder={t("practReasonPlaceholder")}
        style={{ width: "100%", resize: "vertical" }}
      />
    </label>
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--space-2)", alignItems: "center" }}>
        {chip(t(`modStatus_${moderationStatus}` as Parameters<typeof t>[0]), STATUS_COLOR[moderationStatus])}
        {payoutsFrozen && chip(t("practPayoutsFrozen"), "#c0392b")}
      </div>

      {/* Effective commission + where it comes from. */}
      <div style={{ font: "var(--text-body-sm)", color: "var(--text-secondary)" }}>
        <span style={{ font: "var(--text-label)", textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--text-tertiary)" }}>
          {t("commissionLabel")}
        </span>{" "}
        <strong style={{ color: commissionOverride != null ? "#a15c00" : "var(--text-secondary)" }}>{fmtPct(effectiveRate)}%</strong>{" "}
        {commissionOverride != null
          ? t("commissionSourceOverride", { reason: commissionReason ?? "—", date: commissionSetOn ?? "—" })
          : t("commissionSourceDefault")}
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--space-2)" }}>
        {MOD_TARGETS.filter((s) => s !== moderationStatus).map((s) => (
          <Button key={s} type="button" variant={s === "suspended" ? "secondary" : "ghost"} size="sm" onClick={() => openMod(s)}>
            {t(`practAction_${s}` as Parameters<typeof t>[0])}
          </Button>
        ))}
        <Button type="button" variant="ghost" size="sm" onClick={() => openPay(!payoutsFrozen)}>
          {payoutsFrozen ? t("practPayoutsRelease") : t("practPayoutsFreeze")}
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={openComm}>
          {t("commissionButton")}
        </Button>
        <Link
          href={`/admin/practitioners/${practitionerId}/cancel`}
          style={{ font: "var(--text-body-sm)", color: "#c0392b", alignSelf: "center", fontWeight: 600 }}
        >
          {t("bulkLink")} →
        </Link>
      </div>

      {/* Moderation reason dialog */}
      <dialog ref={modRef} style={dialogStyle} onClick={(e) => e.target === modRef.current && modRef.current?.close()}>
        <form action={submitMod} style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
          <input type="hidden" name="status" value={pendingStatus} />
          <h2 style={{ margin: 0, font: "var(--text-heading-sm)" }}>
            {t(`practAction_${pendingStatus}` as Parameters<typeof t>[0])} — {name}
          </h2>
          <p style={{ margin: 0, font: "var(--text-body-sm)", color: "var(--text-secondary)" }}>
            {t(`practConsequence_${pendingStatus}` as Parameters<typeof t>[0])}
          </p>
          {reasonField}
          {modError && <p style={{ margin: 0, font: "var(--text-body-sm)", color: "#c0392b" }}>{errorText(modError)}</p>}
          <div style={{ display: "flex", justifyContent: "flex-end", gap: "var(--space-2)" }}>
            <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => modRef.current?.close()}>
              {t("practCancel")}
            </Button>
            <Button type="submit" size="sm" disabled={busy}>
              {busy ? t("practApplying") : t("practConfirm")}
            </Button>
          </div>
        </form>
      </dialog>

      {/* Payouts reason dialog */}
      <dialog ref={payRef} style={dialogStyle} onClick={(e) => e.target === payRef.current && payRef.current?.close()}>
        <form action={submitPay} style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
          <input type="hidden" name="frozen" value={String(pendingFrozen)} />
          <h2 style={{ margin: 0, font: "var(--text-heading-sm)" }}>
            {pendingFrozen ? t("practPayoutsFreeze") : t("practPayoutsRelease")} — {name}
          </h2>
          <p style={{ margin: 0, font: "var(--text-body-sm)", color: "var(--text-secondary)" }}>
            {pendingFrozen ? t("practConsequence_payouts_freeze") : t("practConsequence_payouts_release")}
          </p>
          {reasonField}
          {payError && <p style={{ margin: 0, font: "var(--text-body-sm)", color: "#c0392b" }}>{errorText(payError)}</p>}
          <div style={{ display: "flex", justifyContent: "flex-end", gap: "var(--space-2)" }}>
            <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => payRef.current?.close()}>
              {t("practCancel")}
            </Button>
            <Button type="submit" size="sm" disabled={busy}>
              {busy ? t("practApplying") : t("practConfirm")}
            </Button>
          </div>
        </form>
      </dialog>

      {/* Commission override dialog */}
      <dialog ref={commRef} style={dialogStyle} onClick={(e) => e.target === commRef.current && commRef.current?.close()}>
        <form action={submitComm} style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
          <h2 style={{ margin: 0, font: "var(--text-heading-sm)" }}>
            {t("commissionButton")} — {name}
          </h2>
          <label style={{ display: "flex", flexDirection: "column", gap: "var(--space-1)" }}>
            <span style={{ font: "var(--text-body-sm)", fontWeight: 600 }}>{t("commissionRateLabel")}</span>
            <input
              type="number"
              name="rate"
              min={0}
              max={100}
              step="any"
              inputMode="decimal"
              defaultValue={commissionOverride != null ? fmtPct(commissionOverride) : ""}
              placeholder={fmtPct(brandDefaultRate)}
              className="form-field"
              style={{ width: "100%" }}
            />
            <span style={{ font: "var(--text-caption)", color: "var(--text-tertiary)" }}>
              {t("commissionRateHint", { default: fmtPct(brandDefaultRate) })}
            </span>
          </label>
          {reasonField}
          {commError && <p style={{ margin: 0, font: "var(--text-body-sm)", color: "#c0392b" }}>{errorText(commError)}</p>}
          <div style={{ display: "flex", justifyContent: "flex-end", gap: "var(--space-2)" }}>
            <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => commRef.current?.close()}>
              {t("practCancel")}
            </Button>
            <Button type="submit" size="sm" disabled={busy}>
              {busy ? t("practApplying") : t("practConfirm")}
            </Button>
          </div>
        </form>
      </dialog>
    </div>
  );
}
