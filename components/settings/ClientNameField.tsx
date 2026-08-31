"use client";

import { useActionState, useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/Button";
import { EditPencilButton } from "@/components/practitioner-profile/EditPencilButton";
import { RenameLimitNote } from "./RenameLimitNote";
import { updateClientDisplayName, type NameFormState } from "@/app/[locale]/client-dashboard/name-actions";
import type { RenameUsage } from "@/lib/rename-limits";

const initialState: NameFormState = null;
const MAX_DISPLAY_NAME_LENGTH = 100;

// The name a client's practitioners see. Same pencil-to-edit pattern as
// UsernameSection/EditableIdentity — the limit note only appears once the
// field is actually opened for editing, not as permanent noise.
export function ClientNameField({ initialName, usage }: { initialName: string; usage: RenameUsage }) {
  const t = useTranslations("Profile");
  const tSettings = useTranslations("AccountSettings");
  const [isEditing, setIsEditing] = useState(false);
  const [name, setName] = useState(initialName);
  const [state, formAction, pending] = useActionState(updateClientDisplayName, initialState);
  // Close the editor on a successful save — adjusted during render, same
  // pattern as the other editable fields in this app.
  const [prevState, setPrevState] = useState(state);
  if (state !== prevState) {
    setPrevState(state);
    if (state?.success && isEditing) setIsEditing(false);
  }

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
        <h2 style={{ margin: 0, font: "var(--text-heading-sm)" }}>{tSettings("clientNameSectionTitle")}</h2>
        <p style={{ margin: "var(--space-1) 0 0", font: "var(--text-body-sm)", color: "var(--text-tertiary)" }}>
          {tSettings("clientNameSectionDescription")}
        </p>
      </div>

      {!isEditing ? (
        <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)" }}>
          {initialName ? (
            <span style={{ font: "var(--text-body-md)" }}>{initialName}</span>
          ) : (
            <span style={{ font: "var(--text-body-md)", color: "var(--text-tertiary)", fontStyle: "italic" }}>
              {tSettings("clientNameNotSetLabel")}
            </span>
          )}
          <EditPencilButton label={tSettings("editClientNameLabel")} onClick={() => setIsEditing(true)} />
        </div>
      ) : (
        <form action={formAction} style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)", maxWidth: 400 }}>
          <RenameLimitNote usage={usage} kind="name" />
          <label>
            {t("displayNameLabel")}
            <input
              name="displayName"
              type="text"
              maxLength={MAX_DISPLAY_NAME_LENGTH}
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="form-field"
              style={{ width: "100%" }}
            />
          </label>
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
                setName(initialName);
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
