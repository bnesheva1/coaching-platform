"use client";

import { useActionState, useState, useSyncExternalStore } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/Button";
import { updateScheduleSettings, type ScheduleSettingsFormState } from "./schedule-settings-actions";

const initialState: ScheduleSettingsFormState = null;

// Computed once — stable within a browser session, no need to recompute
// per render. Ported from the old ProfileForm.tsx verbatim.
const TIMEZONES = typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("timeZone") : [];

// Same useSyncExternalStore pattern as the old ProfileForm.tsx — the
// browser's timezone can't be known during SSR, so it must differ
// safely between the server snapshot and the client one.
function subscribeToNothing() {
  return () => {};
}
function getDetectedTimezone(): string | null {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return null;
  }
}
function getServerTimezoneSnapshot(): string | null {
  return null;
}

// Split out of the old ProfileForm — timezone and notice window moved
// here from the Profile tab since they're scheduling mechanics, not
// profile identity (see the practitioner-profile feature's plan for the
// full reasoning). Same fields, same validation, same detected-timezone
// prompt, just relocated and backed by updateScheduleSettings instead
// of the old monolithic saveProfile.
export function ScheduleSettingsForm({
  initialTimezone,
  initialMinNoticeHours,
}: {
  initialTimezone: string;
  initialMinNoticeHours: number;
}) {
  const t = useTranslations("Profile");
  const [state, formAction, pending] = useActionState(updateScheduleSettings, initialState);
  const [timezone, setTimezone] = useState(initialTimezone);
  const browserTimezone = useSyncExternalStore(subscribeToNothing, getDetectedTimezone, getServerTimezoneSnapshot);
  const detectedTimezone = browserTimezone && browserTimezone !== initialTimezone ? browserTimezone : null;

  return (
    <section style={{ marginBottom: "var(--space-8)" }}>
      <form action={formAction} style={{ display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
        <label>
          {t("timezoneLabel")}
          <br />
          <select
            name="timezone"
            value={timezone}
            onChange={(e) => setTimezone(e.target.value)}
            className="form-field"
            style={{ width: "100%" }}
          >
            {TIMEZONES.map((tz) => (
              <option key={tz} value={tz}>
                {tz}
              </option>
            ))}
          </select>
        </label>
        {detectedTimezone && detectedTimezone !== timezone && (
          <p style={{ font: "var(--text-body-sm)", color: "var(--text-tertiary)", marginTop: "calc(-1 * var(--space-2))" }}>
            {t("timezoneDetectedPrompt", { timezone: detectedTimezone })}{" "}
            <Button type="button" variant="ghost" size="sm" onClick={() => setTimezone(detectedTimezone)}>
              {t("timezoneUseDetected")}
            </Button>
          </p>
        )}

        <label>
          {t("minNoticeHoursLabel")}
          <br />
          <input
            name="minNoticeHours"
            type="number"
            min={1}
            max={48}
            step={1}
            defaultValue={initialMinNoticeHours}
            className="form-field"
            style={{ width: "100%" }}
          />
        </label>
        <p style={{ font: "var(--text-body-sm)", color: "var(--text-tertiary)", marginTop: "calc(-1 * var(--space-2))" }}>
          {t("minNoticeHoursHint")}
        </p>

        {state?.error && <p style={{ color: "crimson" }}>{state.error}</p>}
        {state?.success && <p style={{ color: "green" }}>{t("savedMessage")}</p>}

        <div>
          <Button type="submit" disabled={pending}>
            {pending ? t("saveButtonPending") : t("saveButton")}
          </Button>
        </div>
      </form>
    </section>
  );
}
