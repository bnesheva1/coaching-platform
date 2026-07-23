"use client";

import { useActionState, useState, useSyncExternalStore } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/Button";
import { EditPencilButton } from "@/components/practitioner-profile/EditPencilButton";
import { updateTimezone, type ScheduleSettingsFormState } from "./schedule-settings-actions";

const initialState: ScheduleSettingsFormState = null;

// Computed once — stable within a browser session, no need to recompute
// per render. Ported from the old ScheduleSettingsForm.tsx verbatim.
const TIMEZONES = typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("timeZone") : [];

// Same useSyncExternalStore pattern as SlotPicker.tsx / BookingsList.tsx —
// the browser's timezone can't be known during SSR, so the server and
// client snapshots must differ safely rather than via useEffect+setState.
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

// Deliberately NOT wrapped in the card recipe the sections below it use
// — a plain top-of-page readout + inline pencil-edit, the same "small
// editable fact" pattern as EditableIdentity.tsx on the profile page,
// not a form section of its own. Timezone is read constantly (every
// section below references it) but changed rarely, so it earns
// top billing without earning a whole card around it.
export function TimezoneField({ initialTimezone }: { initialTimezone: string }) {
  const t = useTranslations("Profile");
  const [isEditing, setIsEditing] = useState(false);
  const [state, formAction, pending] = useActionState(updateTimezone, initialState);
  const [timezone, setTimezone] = useState(initialTimezone);
  // See EditableAbout.tsx's identical comment on why this is adjusted
  // during render rather than via useEffect+setState.
  const [prevState, setPrevState] = useState(state);
  if (state !== prevState) {
    setPrevState(state);
    if (state?.success && isEditing) setIsEditing(false);
  }

  const browserTimezone = useSyncExternalStore(subscribeToNothing, getDetectedTimezone, getServerTimezoneSnapshot);
  const detectedTimezone = browserTimezone && browserTimezone !== timezone ? browserTimezone : null;

  // state?.success updates the saved value optimistically from the
  // form's own local `timezone` state — the server already confirmed
  // it, and re-deriving from a fresh server round-trip would mean
  // either a full page reload or plumbing the new value back down as a
  // prop, neither of which anything else on this page needs to do.
  const displayedTimezone = state?.success ? timezone : initialTimezone;

  if (!isEditing) {
    return (
      <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)" }}>
        <p style={{ margin: 0, font: "var(--text-body-md)" }}>
          <strong>{t("timezoneLabel")}:</strong> {displayedTimezone}
        </p>
        <EditPencilButton label={t("editTimezone")} onClick={() => setIsEditing(true)} />
      </div>
    );
  }

  return (
    <form
      action={formAction}
      style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)", maxWidth: 400 }}
    >
      <label>
        {t("timezoneLabel")}
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
        <p style={{ font: "var(--text-body-sm)", color: "var(--text-tertiary)", margin: 0 }}>
          {t("timezoneDetectedPrompt", { timezone: detectedTimezone })}{" "}
          <Button type="button" variant="ghost" size="sm" onClick={() => setTimezone(detectedTimezone)}>
            {t("timezoneUseDetected")}
          </Button>
        </p>
      )}
      {state?.error && <p style={{ color: "crimson" }}>{state.error}</p>}
      <div style={{ display: "flex", gap: "var(--space-2)" }}>
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? t("saveButtonPending") : t("saveButton")}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => {
            // Reset the in-progress selection too, not just the mode —
            // otherwise reopening edit after a cancel would show the
            // abandoned pick instead of the actually-saved timezone.
            setTimezone(displayedTimezone);
            setIsEditing(false);
          }}
        >
          {t("cancelButton")}
        </Button>
      </div>
    </form>
  );
}
