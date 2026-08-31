"use client";

import { useActionState, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/Button";
import { EditPencilButton } from "@/components/practitioner-profile/EditPencilButton";
import { RenameLimitNote } from "./RenameLimitNote";
import { updateUsername, checkUsernameAvailability, type ProfileFormState } from "@/app/[locale]/practitioner-dashboard/actions";
import type { RenameUsage } from "@/lib/rename-limits";

const initialState: ProfileFormState = null;

// Mirrors MIN/MAX_USERNAME_LENGTH in lib/validation/username.ts — same
// duplicated-not-imported reasoning as EditableIdentity.tsx.
const MIN_USERNAME_LENGTH = 3;
const MAX_USERNAME_LENGTH = 30;

// Moved here from the Profile tab's own ProfileSettingsBox — username
// is account-identity, not "what a client sees on your public profile"
// (which is what the rest of that tab is about), so Settings is the
// more honest home for it. Same live-availability-check UX, ported as
// unchanged as possible (only the last *completed* check result is
// stored, "checking" is derived by comparing the current input against
// what that result was for), just restyled to match this page's own
// section pattern instead of the Card component the old box used.
//
// Same pencil-click-to-edit pattern as EditableIdentity.tsx/
// EditableAbout.tsx — a plain static display plus EditPencilButton,
// not always-editable — specifically so the URL-breaking warning below
// only shows once someone has actually signaled intent to change it,
// not as permanent noise next to the read-only common case.
type CheckResult = { username: string; available: boolean; reason?: string };

export function UsernameSection({ initialUsername, usage }: { initialUsername: string | null; usage: RenameUsage }) {
  const t = useTranslations("Profile");
  const tSettings = useTranslations("AccountSettings");
  const [isEditing, setIsEditing] = useState(false);
  const [state, formAction, pending] = useActionState(updateUsername, initialState);
  const [username, setUsername] = useState(initialUsername ?? "");
  const [lastResult, setLastResult] = useState<CheckResult | null>(null);
  // Close the editor once a save succeeds — adjusted during render, not
  // via useEffect+setState, same pattern as EditableIdentity.tsx etc.
  const [prevState, setPrevState] = useState(state);
  if (state !== prevState) {
    setPrevState(state);
    if (state?.success && isEditing) setIsEditing(false);
  }

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
    <section
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "var(--space-3)",
        padding: "var(--space-4)",
        border: "1px solid var(--border-subtle)",
        borderRadius: "var(--radius-lg)",
        background: "var(--bg-surface)",
      }}
    >
      <div>
        <h2 style={{ margin: 0, font: "var(--text-heading-sm)" }}>{tSettings("usernameSectionTitle")}</h2>
        <p style={{ margin: "var(--space-1) 0 0", font: "var(--text-body-sm)", color: "var(--text-tertiary)" }}>
          {tSettings("usernameSectionDescription")}
        </p>
      </div>

      {!isEditing ? (
        <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)" }}>
          {initialUsername ? (
            <span style={{ font: "var(--text-body-md)" }}>{initialUsername}</span>
          ) : (
            <span style={{ font: "var(--text-body-md)", color: "var(--text-tertiary)", fontStyle: "italic" }}>
              {tSettings("usernameNotSetLabel")}
            </span>
          )}
          <EditPencilButton label={tSettings("editUsernameLabel")} onClick={() => setIsEditing(true)} />
        </div>
      ) : (
        <form action={formAction} style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)", maxWidth: 400 }}>
          {/* Shown as soon as the field opens: the limit + how many changes
              remain (or the date it can change again at the limit), and —
              for usernames — that the old address keeps redirecting. */}
          <RenameLimitNote usage={usage} kind="username" />
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
          {isAvailable && <p style={{ font: "var(--text-body-sm)", color: "var(--color-success)", margin: 0 }}>{t("available")}</p>}
          {unavailableReason && <p style={{ font: "var(--text-body-sm)", color: "var(--color-danger)", margin: 0 }}>{unavailableReason}</p>}
          {state?.error && <p style={{ color: "var(--color-danger)", margin: 0 }}>{state.error}</p>}
          {state?.success && <p style={{ color: "var(--color-success)", margin: 0 }}>{t("savedMessage")}</p>}
          <div style={{ display: "flex", gap: "var(--space-2)" }}>
            <Button type="submit" size="sm" disabled={pending || usage.remaining <= 0}>
              {pending ? t("saveButtonPending") : t("saveButton")}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                setUsername(initialUsername ?? "");
                setIsEditing(false);
              }}
            >
              {t("cancelButton")}
            </Button>
          </div>
        </form>
      )}
    </section>
  );
}
