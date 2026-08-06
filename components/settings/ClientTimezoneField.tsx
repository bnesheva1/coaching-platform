"use client";

import { useActionState, useState, useSyncExternalStore } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/Button";
import { updateClientTimezone, type ClientTimezoneState } from "@/app/[locale]/client-dashboard/timezone-actions";

// Computed once — stable within a session. Same source as the practitioner
// TimezoneField.
const TIMEZONES = typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("timeZone") : [];

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
function getServerSnapshot(): string | null {
  return null;
}

const initialState: ClientTimezoneState = null;

// The client's own display-timezone picker, in their settings. Unlike the
// practitioner's (which always has a saved value from onboarding), a
// client may have none yet — so the select defaults to the browser's
// detected zone until they save one.
export function ClientTimezoneField({ initialTimezone }: { initialTimezone: string | null }) {
  const t = useTranslations("AccountSettings");
  const [state, formAction, pending] = useActionState(updateClientTimezone, initialState);
  const [selected, setSelected] = useState(initialTimezone ?? "");

  const detected = useSyncExternalStore(subscribeToNothing, getDetectedTimezone, getServerSnapshot);
  // What the select shows: an explicit pick, else the saved value, else
  // the browser guess. Keeps the field useful before anything is saved.
  const effective = selected || detected || "";

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
      <h2 style={{ margin: 0, font: "var(--text-heading-sm)" }}>{t("timezoneTitle")}</h2>
      <p style={{ margin: 0, font: "var(--text-body-sm)", color: "var(--text-tertiary)" }}>
        {t("timezoneDescription")}
      </p>
      <form action={formAction} style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)", maxWidth: 400 }}>
        <select
          name="timezone"
          value={effective}
          onChange={(e) => setSelected(e.target.value)}
          className="form-field"
          style={{ width: "100%" }}
        >
          {effective === "" && (
            <option value="" disabled>
              {t("timezoneChoose")}
            </option>
          )}
          {TIMEZONES.map((tz) => (
            <option key={tz} value={tz}>
              {tz}
            </option>
          ))}
        </select>
        {detected && detected !== effective && (
          <p style={{ font: "var(--text-body-sm)", color: "var(--text-tertiary)", margin: 0 }}>
            {t("timezoneDetected", { timezone: detected })}{" "}
            <Button type="button" variant="ghost" size="sm" onClick={() => setSelected(detected)}>
              {t("timezoneUseDetected")}
            </Button>
          </p>
        )}
        {state?.error && <p style={{ color: "crimson", margin: 0 }}>{state.error}</p>}
        {state?.success && <p style={{ color: "green", margin: 0 }}>{t("timezoneSaved")}</p>}
        <div>
          <Button type="submit" size="sm" disabled={pending || effective === ""}>
            {pending ? t("timezoneSaving") : t("timezoneSave")}
          </Button>
        </div>
      </form>
    </section>
  );
}
