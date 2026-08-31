"use client";

import { useActionState, useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/Button";
import { EditPencilButton } from "@/components/practitioner-profile/EditPencilButton";
import {
  updateEmergencyContact,
  type EmergencyContactState,
} from "@/app/[locale]/practitioner-dashboard/emergency-contact-actions";

const initialState: EmergencyContactState = null;

// The practitioner's optional emergency-contact number, in settings. The
// consequence of the choice is stated right here (emergencyContactDescription)
// — at the point of decision, not buried elsewhere. Blank is a legitimate
// choice, shown as a plain "not set", never an error. View/edit toggle
// (like the timezone field) so the saved value reads plainly after saving.
export function EmergencyContactField({ initialContact }: { initialContact: string | null }) {
  const t = useTranslations("AccountSettings");
  const [isEditing, setIsEditing] = useState(false);
  const [state, formAction, pending] = useActionState(updateEmergencyContact, initialState);
  const [value, setValue] = useState(initialContact ?? "");

  const [prevState, setPrevState] = useState(state);
  if (state !== prevState) {
    setPrevState(state);
    if (state?.success && isEditing) setIsEditing(false);
  }

  const displayed = state?.success ? (value.trim() === "" ? "" : value.trim()) : (initialContact ?? "");

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
      <h2 style={{ margin: 0, font: "var(--text-heading-sm)" }}>{t("emergencyContactTitle")}</h2>
      <p style={{ margin: 0, font: "var(--text-body-sm)", color: "var(--text-secondary)" }}>
        {t("emergencyContactDescription")}
      </p>

      {!isEditing ? (
        <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)" }}>
          <p style={{ margin: 0, font: "var(--text-body-md)" }}>
            {displayed ? (
              <strong>{displayed}</strong>
            ) : (
              <span style={{ color: "var(--text-tertiary)" }}>{t("emergencyContactNotSet")}</span>
            )}
          </p>
          <EditPencilButton label={t("emergencyContactEdit")} onClick={() => setIsEditing(true)} />
        </div>
      ) : (
        <form action={formAction} style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)", maxWidth: 400 }}>
          <label style={{ display: "flex", flexDirection: "column", gap: "var(--space-1)" }}>
            <span style={{ font: "var(--text-label)", color: "var(--text-tertiary)" }}>{t("emergencyContactLabel")}</span>
            <input
              name="emergencyContact"
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              maxLength={100}
              placeholder={t("emergencyContactPlaceholder")}
              className="form-field"
              style={{ width: "100%" }}
            />
          </label>
          {state?.error && <p style={{ color: "var(--color-danger)", margin: 0 }}>{state.error}</p>}
          <div style={{ display: "flex", gap: "var(--space-2)" }}>
            <Button type="submit" size="sm" disabled={pending}>
              {pending ? t("emergencyContactSaving") : t("emergencyContactSave")}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                setValue(displayed || initialContact || "");
                setIsEditing(false);
              }}
            >
              {t("emergencyContactCancel")}
            </Button>
          </div>
        </form>
      )}
    </section>
  );
}
