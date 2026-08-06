"use client";

import { useActionState, useState, useSyncExternalStore } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/Button";
import { EditPencilButton } from "@/components/practitioner-profile/EditPencilButton";
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

// The client's own display-timezone picker, in their settings. Mirrors the
// practitioner TimezoneField's view/edit toggle: a read-only line normally,
// a select only while editing. Leaving edit mode after a save is what makes
// the saved value show plainly afterwards — and sidesteps React 19 resetting
// a controlled <select> inside a form action back to its first option.
// Difference from the practitioner one: a client may have NO saved timezone
// yet, so the read-only line offers to set it and the edit select defaults
// to the browser's detected zone.
export function ClientTimezoneField({ initialTimezone }: { initialTimezone: string | null }) {
  const t = useTranslations("AccountSettings");
  const [isEditing, setIsEditing] = useState(false);
  const [state, formAction, pending] = useActionState(updateClientTimezone, initialState);
  const [selected, setSelected] = useState(initialTimezone ?? "");

  const browserTz = useSyncExternalStore(subscribeToNothing, getDetectedTimezone, getServerSnapshot);
  // What the edit select shows: an explicit pick, else the browser guess.
  const effective = selected || browserTz || "";

  // Same "adjust during render" pattern as the practitioner TimezoneField —
  // leave edit mode once a save succeeds, so the read-only line below shows
  // the value that was just saved.
  const [prevState, setPrevState] = useState(state);
  if (state !== prevState) {
    setPrevState(state);
    if (state?.success && isEditing) setIsEditing(false);
  }

  // The read-only value: the just-saved selection after a successful save,
  // otherwise the value the server loaded.
  const displayedTimezone = state?.success ? effective : initialTimezone ?? "";

  const cardStyle = {
    display: "flex",
    flexDirection: "column",
    gap: "var(--space-2)",
    padding: "var(--space-4)",
    border: "1px solid var(--border-subtle)",
    borderRadius: "var(--radius-lg)",
    background: "var(--bg-surface)",
  } as const;

  return (
    <section style={cardStyle}>
      <h2 style={{ margin: 0, font: "var(--text-heading-sm)" }}>{t("timezoneTitle")}</h2>
      <p style={{ margin: 0, font: "var(--text-body-sm)", color: "var(--text-tertiary)" }}>
        {t("timezoneDescription")}
      </p>

      {!isEditing ? (
        <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)" }}>
          <p style={{ margin: 0, font: "var(--text-body-md)" }}>
            {displayedTimezone ? (
              <strong>{displayedTimezone}</strong>
            ) : (
              <span style={{ color: "var(--text-tertiary)" }}>{t("timezoneNotSet")}</span>
            )}
          </p>
          <EditPencilButton label={t("timezoneEdit")} onClick={() => setIsEditing(true)} />
        </div>
      ) : (
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
          {browserTz && browserTz !== effective && (
            <p style={{ font: "var(--text-body-sm)", color: "var(--text-tertiary)", margin: 0 }}>
              {t("timezoneDetected", { timezone: browserTz })}{" "}
              <Button type="button" variant="ghost" size="sm" onClick={() => setSelected(browserTz)}>
                {t("timezoneUseDetected")}
              </Button>
            </p>
          )}
          {state?.error && <p style={{ color: "crimson", margin: 0 }}>{state.error}</p>}
          <div style={{ display: "flex", gap: "var(--space-2)" }}>
            <Button type="submit" size="sm" disabled={pending || effective === ""}>
              {pending ? t("timezoneSaving") : t("timezoneSave")}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                setSelected(displayedTimezone || initialTimezone || "");
                setIsEditing(false);
              }}
            >
              {t("timezoneCancel")}
            </Button>
          </div>
        </form>
      )}
    </section>
  );
}
