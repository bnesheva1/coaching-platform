"use client";

import { useActionState, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { updateUsername, checkUsernameAvailability, type ProfileFormState } from "@/app/[locale]/practitioner-dashboard/actions";

const initialState: ProfileFormState = null;

// Mirrors MIN/MAX_USERNAME_LENGTH in lib/validation/username.ts — same
// duplicated-not-imported reasoning as EditableIdentity.tsx.
const MIN_USERNAME_LENGTH = 3;
const MAX_USERNAME_LENGTH = 30;

// Same live-availability-check UX as the old ProfileForm.tsx, ported
// as-is (only the last *completed* check result is stored, "checking"
// is derived by comparing the current input against what that result
// was for) — just now backed by the narrower updateUsername action
// instead of the old do-everything saveProfile.
type CheckResult = { username: string; available: boolean; reason?: string };

export function ProfileSettingsBox({ initialUsername }: { initialUsername: string | null }) {
  const t = useTranslations("Profile");
  const tDashboard = useTranslations("Dashboard");
  const [state, formAction, pending] = useActionState(updateUsername, initialState);
  const [username, setUsername] = useState(initialUsername ?? "");
  const [lastResult, setLastResult] = useState<CheckResult | null>(null);

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

  const isChecking = username.length > 0 && username !== initialUsername && lastResult?.username !== username;
  const isAvailable = lastResult?.username === username && lastResult.available;
  const unavailableReason =
    lastResult?.username === username && !lastResult.available ? lastResult.reason : undefined;

  return (
    <Card
      title={tDashboard("settingsTitle")}
      description={tDashboard("settingsScheduleNote")}
      footer={
        <form action={formAction} style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
          <label>
            {t("usernameLabel")}
            <input
              name="username"
              type="text"
              minLength={MIN_USERNAME_LENGTH}
              maxLength={MAX_USERNAME_LENGTH}
              pattern="[a-z0-9_\-]+"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="form-field"
              style={{ width: "100%" }}
            />
          </label>
          <p style={{ font: "var(--text-body-sm)", color: "var(--text-tertiary)", margin: 0 }}>{t("usernameHint")}</p>
          {isChecking && <p style={{ font: "var(--text-body-sm)", color: "var(--text-tertiary)", margin: 0 }}>{t("checkingAvailability")}</p>}
          {isAvailable && <p style={{ font: "var(--text-body-sm)", color: "green", margin: 0 }}>{t("available")}</p>}
          {unavailableReason && <p style={{ font: "var(--text-body-sm)", color: "crimson", margin: 0 }}>{unavailableReason}</p>}
          {state?.error && <p style={{ color: "crimson" }}>{state.error}</p>}
          {state?.success && <p style={{ color: "green" }}>{t("savedMessage")}</p>}
          <div>
            <Button type="submit" size="sm" disabled={pending}>
              {pending ? t("saveButtonPending") : t("saveButton")}
            </Button>
          </div>
        </form>
      }
    />
  );
}
