"use client";

import { useActionState, useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/Button";
import { EditPencilButton } from "@/components/practitioner-profile/EditPencilButton";
import { saveTin, type TinState } from "@/app/[locale]/practitioner-dashboard/tin-actions";
import type { TinType } from "@/lib/tax/tin";

const initialState: TinState = null;

// The practitioner's TIN for DAC7 reporting — ЕГН (individual) or VAT number.
// Sensitive: stored server-side excluded from every read grant; this field only
// ever shows the practitioner their OWN value. View/edit toggle like the other
// settings fields; full validation happens server-side (saveTin).
export function TinField({ initial }: { initial: { tin: string; tinType: TinType } | null }) {
  const t = useTranslations("TaxId");
  const [isEditing, setIsEditing] = useState(false);
  const [state, formAction, pending] = useActionState(saveTin, initialState);
  const [type, setType] = useState<TinType>(initial?.tinType ?? "egn");
  const [value, setValue] = useState(initial?.tin ?? "");

  const [prevState, setPrevState] = useState(state);
  if (state !== prevState) {
    setPrevState(state);
    if (state?.success && isEditing) setIsEditing(false);
  }

  const savedTin = state?.success ? value.trim() : (initial?.tin ?? "");
  const savedType = state?.success ? type : (initial?.tinType ?? null);

  return (
    <section
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "var(--space-2)",
        padding: "var(--space-4)",
        border: "1px solid var(--border-subtle)",
        borderRadius: "var(--radius-lg)",
        background: "var(--bg-surface)",
      }}
    >
      <h2 style={{ margin: 0, font: "var(--text-heading-sm)" }}>{t("title")}</h2>
      <p style={{ margin: 0, font: "var(--text-body-sm)", color: "var(--text-secondary)" }}>{t("description")}</p>

      {!isEditing ? (
        <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)" }}>
          <p style={{ margin: 0, font: "var(--text-body-md)" }}>
            {savedTin ? (
              <strong>
                {savedTin} <span style={{ font: "var(--text-body-sm)", color: "var(--text-tertiary)" }}>({t(savedType === "vat" ? "vatOption" : "egnOption")})</span>
              </strong>
            ) : (
              <span style={{ color: "var(--text-tertiary)" }}>{t("notSet")}</span>
            )}
          </p>
          <EditPencilButton label={t("edit")} onClick={() => setIsEditing(true)} />
        </div>
      ) : (
        <form action={formAction} style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)", maxWidth: 400 }}>
          <div style={{ display: "flex", gap: "var(--space-3)" }}>
            <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <input type="radio" name="tinType" value="egn" checked={type === "egn"} onChange={() => setType("egn")} /> {t("egnOption")}
            </label>
            <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <input type="radio" name="tinType" value="vat" checked={type === "vat"} onChange={() => setType("vat")} /> {t("vatOption")}
            </label>
          </div>
          <label style={{ display: "flex", flexDirection: "column", gap: "var(--space-1)" }}>
            <span style={{ font: "var(--text-label)", color: "var(--text-tertiary)" }}>{t("label")}</span>
            <input
              name="tin"
              inputMode={type === "egn" ? "numeric" : "text"}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              maxLength={20}
              placeholder={type === "egn" ? t("egnPlaceholder") : t("vatPlaceholder")}
              className="form-field"
              style={{ width: "100%" }}
              autoComplete="off"
            />
          </label>
          {state?.error && <p style={{ color: "var(--color-danger)", margin: 0 }}>{state.error}</p>}
          <div style={{ display: "flex", gap: "var(--space-2)" }}>
            <Button type="submit" size="sm" disabled={pending}>
              {pending ? t("saving") : t("save")}
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={() => { setValue(initial?.tin ?? ""); setType(initial?.tinType ?? "egn"); setIsEditing(false); }}>
              {t("cancel")}
            </Button>
          </div>
        </form>
      )}
    </section>
  );
}
