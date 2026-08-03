"use client";

import { useActionState, useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/Button";
import { updateProfileText, type ProfileFormState } from "@/app/[locale]/practitioner-dashboard/actions";
import { EditPencilButton } from "./EditPencilButton";

const initialState: ProfileFormState = null;

// Mirrors MAX_BIO_LENGTH in actions.ts — see EditableIdentity.tsx's
// identical comment on why this is duplicated rather than imported.
const MAX_BIO_LENGTH = 1000;

// Inline replace-with-textarea on pencil click (LinkedIn's own About-
// section pattern) — not a modal, since it's a single field.
export function EditableAbout({ bio }: { bio: string }) {
  const t = useTranslations("Profile");
  const [isEditing, setIsEditing] = useState(false);
  const [state, formAction, pending] = useActionState(updateProfileText, initialState);
  // Close the editor once a save succeeds — adjusted during render
  // (React's own documented pattern for this), not via useEffect+
  // setState, which this project's lint config flags
  // (react-hooks/set-state-in-effect) for the cascading-render risk.
  const [prevState, setPrevState] = useState(state);
  // Bumped every time the action returns (error or success) and used as
  // the <form>'s own key below — forces a remount so a corrected
  // defaultValue actually takes effect after a rejected submission. See
  // ProfileFormState's own comment (actions.ts) and
  // EditableIdentity.tsx's identical block for why this is needed.
  const [formKey, setFormKey] = useState(0);
  if (state !== prevState) {
    setPrevState(state);
    setFormKey((k) => k + 1);
    if (state?.success && isEditing) setIsEditing(false);
  }

  if (!isEditing) {
    return (
      <div style={{ position: "relative" }}>
        <div style={{ position: "absolute", top: 0, right: 0 }}>
          <EditPencilButton label={t("editAbout")} onClick={() => setIsEditing(true)} />
        </div>
        {bio ? (
          bio.split("\n\n").map((paragraph, i) => (
            <p key={i} style={{ font: "var(--text-body-md)", color: "var(--text-secondary)" }}>
              {paragraph}
            </p>
          ))
        ) : (
          <p style={{ font: "var(--text-body-md)", color: "var(--text-tertiary)" }}>{t("aboutEmpty")}</p>
        )}
      </div>
    );
  }

  return (
    <form key={formKey} action={formAction} style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
      <textarea name="bio" defaultValue={state?.values?.bio ?? bio} rows={6} maxLength={MAX_BIO_LENGTH} className="form-field" style={{ width: "100%" }} />
      {state?.error && <p style={{ color: "crimson" }}>{state.error}</p>}
      <div style={{ display: "flex", gap: "var(--space-2)" }}>
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? t("saveButtonPending") : t("saveButton")}
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={() => setIsEditing(false)}>
          {t("cancelButton")}
        </Button>
      </div>
    </form>
  );
}
