"use client";

import { useActionState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/Button";
import { updateMinNoticeHours, type ScheduleSettingsFormState } from "./schedule-settings-actions";

const initialState: ScheduleSettingsFormState = null;

// Least-frequently-touched field on the whole page — a practitioner
// sets this once and rarely revisits it — so it sits last. Flat, no
// card, same treatment as the other section headings; compact inline
// row (narrow field + Save side by side) rather than a full-width
// stacked form, since it's genuinely just one small number.
export function MinNoticeHoursForm({ initialMinNoticeHours }: { initialMinNoticeHours: number }) {
  const t = useTranslations("Profile");
  const [state, formAction, pending] = useActionState(updateMinNoticeHours, initialState);

  return (
    <section>
      <h2 style={{ margin: "0 0 var(--space-2)", font: "var(--text-heading-md)" }}>{t("minNoticeHoursTitle")}</h2>
      <form action={formAction} style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
        <label style={{ display: "flex", alignItems: "center", gap: "var(--space-2)" }}>
          {t("minNoticeHoursLabel")}
          <input
            name="minNoticeHours"
            type="number"
            min={1}
            max={48}
            step={1}
            defaultValue={initialMinNoticeHours}
            className="form-field"
            style={{ width: "5rem" }}
          />
          <Button type="submit" size="sm" disabled={pending}>
            {pending ? t("saveButtonPending") : t("saveButton")}
          </Button>
        </label>
        <p style={{ font: "var(--text-body-sm)", color: "var(--text-tertiary)", margin: 0 }}>
          {t("minNoticeHoursHint")}
        </p>

        {state?.error && <p style={{ color: "crimson", margin: 0 }}>{state.error}</p>}
        {state?.success && <p style={{ color: "green", margin: 0 }}>{t("savedMessage")}</p>}
      </form>
    </section>
  );
}
