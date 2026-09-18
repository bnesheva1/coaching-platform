"use client";

import { useActionState, useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/Button";
import { EditPencilButton } from "@/components/practitioner-profile/EditPencilButton";
import { saveIban, type IbanState } from "@/app/[locale]/practitioner-dashboard/iban-actions";

const initialState: IbanState = null;

// The practitioner's IBAN for DAC7 reporting. Sensitive: stored excluded from
// every read grant; only ever shown to the practitioner themselves. View/edit
// toggle like the TIN field; full MOD-97 validation happens server-side.
export function IbanField({ initial }: { initial: string | null }) {
  const t = useTranslations("TaxId");
  const [isEditing, setIsEditing] = useState(false);
  const [state, formAction, pending] = useActionState(saveIban, initialState);
  const [value, setValue] = useState(initial ?? "");

  const [prevState, setPrevState] = useState(state);
  if (state !== prevState) {
    setPrevState(state);
    if (state?.success && isEditing) setIsEditing(false);
  }

  const displayed = state?.success ? value.trim().replace(/\s+/g, "").toUpperCase() : (initial ?? "");

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
      <h2 style={{ margin: 0, font: "var(--text-heading-sm)" }}>{t("ibanTitle")}</h2>
      <p style={{ margin: 0, font: "var(--text-body-sm)", color: "var(--text-secondary)" }}>{t("ibanDescription")}</p>

      {!isEditing ? (
        <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)" }}>
          <p style={{ margin: 0, font: "var(--text-body-md)" }}>
            {displayed ? <strong>{displayed}</strong> : <span style={{ color: "var(--text-tertiary)" }}>{t("notSet")}</span>}
          </p>
          <EditPencilButton label={t("edit")} onClick={() => setIsEditing(true)} />
        </div>
      ) : (
        <form action={formAction} style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)", maxWidth: 400 }}>
          <label style={{ display: "flex", flexDirection: "column", gap: "var(--space-1)" }}>
            <span style={{ font: "var(--text-label)", color: "var(--text-tertiary)" }}>{t("ibanLabel")}</span>
            <input
              name="iban"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              maxLength={42}
              placeholder={t("ibanPlaceholder")}
              className="form-field"
              style={{ width: "100%" }}
              autoComplete="off"
              spellCheck={false}
            />
          </label>
          {state?.error && <p style={{ color: "var(--color-danger)", margin: 0 }}>{state.error}</p>}
          <div style={{ display: "flex", gap: "var(--space-2)" }}>
            <Button type="submit" size="sm" disabled={pending}>
              {pending ? t("saving") : t("save")}
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={() => { setValue(initial ?? ""); setIsEditing(false); }}>
              {t("cancel")}
            </Button>
          </div>
        </form>
      )}
    </section>
  );
}
