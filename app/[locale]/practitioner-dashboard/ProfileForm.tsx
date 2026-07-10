"use client";

import { useActionState, useEffect, useState, useSyncExternalStore } from "react";
import { useTranslations, useLocale } from "next-intl";
import { saveProfile, checkUsernameAvailability, type ProfileFormState } from "./actions";
import specialties from "@/data/specialties.json";

const initialState: ProfileFormState = null;

// Computed once — stable within a browser session, no need to recompute
// per render. ~400 real IANA identifiers, no external data file needed.
const TIMEZONES = typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("timeZone") : [];

// The browser's timezone can't be known during SSR, so it must differ
// between the server-rendered snapshot and the client one — exactly the
// case useSyncExternalStore exists for (unlike a plain useEffect+setState,
// it hands React the server snapshot during hydration and swaps to the
// real client value right after, without a hydration-mismatch warning).
// No real subscription exists (a browser's timezone essentially never
// changes mid-session), so `subscribe` is a permanent no-op.
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

// Same pattern as the old signup-form live check: only the last
// *completed* check result is stored, "checking" is derived by comparing
// the current input against what that result was for. Also skips the
// check entirely when the field still matches what's already saved, so
// opening the page doesn't immediately re-check your own username.
type CheckResult = { username: string; available: boolean; reason?: string };

export function ProfileForm({
  initialUsername,
  initialDisplayName,
  initialBio,
  initialSpecialties,
  initialAvatarUrl,
  initialTimezone,
  initialMinNoticeHours,
}: {
  initialUsername: string | null;
  initialDisplayName: string;
  initialBio: string;
  initialSpecialties: string[];
  initialAvatarUrl: string | null;
  initialTimezone: string;
  initialMinNoticeHours: number;
}) {
  const t = useTranslations("Profile");
  const locale = useLocale() as "en" | "bg";
  const [state, formAction, pending] = useActionState(saveProfile, initialState);
  const [username, setUsername] = useState(initialUsername ?? "");
  const [lastResult, setLastResult] = useState<CheckResult | null>(null);
  const [timezone, setTimezone] = useState(initialTimezone);
  const browserTimezone = useSyncExternalStore(
    subscribeToNothing,
    getDetectedTimezone,
    getServerTimezoneSnapshot,
  );
  const detectedTimezone =
    browserTimezone && browserTimezone !== initialTimezone ? browserTimezone : null;

  useEffect(() => {
    if (!username || username === initialUsername) {
      return;
    }

    const timeout = setTimeout(async () => {
      const result = await checkUsernameAvailability(username);
      setLastResult({
        username,
        available: result.available,
        reason: result.available ? undefined : result.reason,
      });
    }, 400);

    return () => clearTimeout(timeout);
  }, [username, initialUsername]);

  const isChecking =
    username.length > 0 && username !== initialUsername && lastResult?.username !== username;
  const isAvailable = lastResult?.username === username && lastResult.available;
  const unavailableReason =
    lastResult?.username === username && !lastResult.available
      ? lastResult.reason
      : undefined;

  return (
    <form
      action={formAction}
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "1rem",
        maxWidth: 400,
      }}
    >
      <label>
        {t("usernameLabel")}
        <br />
        <input
          name="username"
          type="text"
          minLength={3}
          pattern="[a-z0-9_\-]+"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          style={{ width: "100%" }}
        />
      </label>
      <p style={{ fontSize: "0.85rem", color: "#666", marginTop: "-0.5rem" }}>
        {t("usernameHint")}
      </p>
      {isChecking && (
        <p style={{ fontSize: "0.85rem", color: "#666", marginTop: "-0.5rem" }}>
          {t("checkingAvailability")}
        </p>
      )}
      {isAvailable && (
        <p style={{ fontSize: "0.85rem", color: "green", marginTop: "-0.5rem" }}>
          {t("available")}
        </p>
      )}
      {unavailableReason && (
        <p style={{ fontSize: "0.85rem", color: "crimson", marginTop: "-0.5rem" }}>
          {unavailableReason}
        </p>
      )}

      <label>
        {t("displayNameLabel")}
        <br />
        <input
          name="displayName"
          type="text"
          defaultValue={initialDisplayName}
          style={{ width: "100%" }}
        />
      </label>
      <p style={{ fontSize: "0.85rem", color: "#666", marginTop: "-0.5rem" }}>
        {t("displayNameHint")}
      </p>

      <label>
        {t("timezoneLabel")}
        <br />
        <select
          name="timezone"
          value={timezone}
          onChange={(e) => setTimezone(e.target.value)}
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
        <p style={{ fontSize: "0.85rem", color: "#666", marginTop: "-0.5rem" }}>
          {t("timezoneDetectedPrompt", { timezone: detectedTimezone })}{" "}
          <button
            type="button"
            onClick={() => setTimezone(detectedTimezone)}
            style={{ fontSize: "0.85rem" }}
          >
            {t("timezoneUseDetected")}
          </button>
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
          style={{ width: "100%" }}
        />
      </label>
      <p style={{ fontSize: "0.85rem", color: "#666", marginTop: "-0.5rem" }}>
        {t("minNoticeHoursHint")}
      </p>

      <label>
        {t("bioLabel")}
        <br />
        <textarea
          name="bio"
          rows={5}
          defaultValue={initialBio}
          style={{ width: "100%" }}
        />
      </label>

      <fieldset>
        <legend>{t("specialtiesLegend")}</legend>
        {specialties.map((specialty) => (
          <label key={specialty.key} style={{ display: "block" }}>
            <input
              type="checkbox"
              name="specialties"
              value={specialty.key}
              defaultChecked={initialSpecialties.includes(specialty.key)}
            />{" "}
            {specialty[locale]}
          </label>
        ))}
      </fieldset>

      <label>
        {t("photoLabel")}
        <br />
        {initialAvatarUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={initialAvatarUrl}
            alt={t("photoAlt")}
            style={{
              width: 100,
              height: 100,
              objectFit: "cover",
              borderRadius: "50%",
              display: "block",
              marginBottom: "0.5rem",
            }}
          />
        )}
        <input type="file" name="avatar" accept="image/png,image/jpeg,image/webp" />
      </label>

      {state?.error && <p style={{ color: "crimson" }}>{state.error}</p>}
      {state?.success && <p style={{ color: "green" }}>{t("savedMessage")}</p>}

      <button type="submit" disabled={pending}>
        {pending ? t("saveButtonPending") : t("saveButton")}
      </button>
    </form>
  );
}
