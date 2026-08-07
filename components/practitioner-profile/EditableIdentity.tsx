"use client";

import { useActionState, useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/Button";
import { updateProfileText, type ProfileFormState } from "@/app/[locale]/practitioner-dashboard/actions";
import { EditPencilButton } from "./EditPencilButton";
import { RenameLimitNote } from "@/components/settings/RenameLimitNote";
import type { RenameUsage } from "@/lib/rename-limits";

const initialState: ProfileFormState = null;

// Mirrors MAX_DISPLAY_NAME_LENGTH/MAX_HEADLINE_LENGTH/MAX_LOCATION_LENGTH
// in actions.ts — duplicated, not imported, same reasoning as
// AvailabilitySection.tsx's MIN_DURATION_MINUTES: that file is a
// "use server" module, which only allows async function exports, so a
// plain constant can't be shared across the client/server boundary
// here. The server action re-validates from scratch regardless; this
// is just so the browser stops you before you type past the limit
// instead of only failing on submit.
const MAX_DISPLAY_NAME_LENGTH = 100;
const MAX_HEADLINE_LENGTH = 150;
const MAX_LOCATION_LENGTH = 100;

// One pencil for name + headline + location together, rather than three
// separate ones — the design source doesn't specify headline/location
// (they don't exist there), so this groups them with the field they
// most resemble in the mockup's layout (directly under the avatar).
export function EditableIdentity({
  displayName,
  headline,
  location,
  nameUsage,
}: {
  displayName: string;
  headline: string;
  location: string;
  // Always provided by the owner profile page (the only place this
  // renders); optional only so the type doesn't force the public view,
  // which never mounts this editor, to compute it.
  nameUsage?: RenameUsage;
}) {
  const t = useTranslations("Profile");
  const [isEditing, setIsEditing] = useState(false);
  const [state, formAction, pending] = useActionState(updateProfileText, initialState);
  // See EditableAbout.tsx's identical comment on why this is adjusted
  // during render rather than via useEffect+setState.
  const [prevState, setPrevState] = useState(state);
  // Bumped every time the action returns (error or success) and used as
  // the <form>'s own key below — forces React to remount it (and every
  // plain defaultValue input inside), which is what actually makes a
  // changed defaultValue take effect after a rejected submission. See
  // ProfileFormState's own comment for why this is needed at all: React
  // resets the underlying native form after ANY action completion, on
  // its own, before this component ever re-renders.
  const [formKey, setFormKey] = useState(0);
  if (state !== prevState) {
    setPrevState(state);
    setFormKey((k) => k + 1);
    if (state?.success && isEditing) setIsEditing(false);
  }

  if (!isEditing) {
    return (
      <div style={{ display: "flex", alignItems: "flex-start", gap: "var(--space-2)" }}>
        <div>
          <h1 style={{ font: "var(--text-heading-lg)", margin: 0 }}>{displayName}</h1>
          {/* Always the owner here (this component only ever renders
              inside edit mode) — placeholder nudges are always shown
              when empty, no isOwner check needed like the read-only
              view has. */}
          {headline ? (
            <p style={{ font: "var(--text-body-md)", color: "var(--text-secondary)", margin: "var(--space-1) 0 0" }}>{headline}</p>
          ) : (
            <p style={{ font: "var(--text-body-md)", color: "var(--text-tertiary)", fontStyle: "italic", margin: "var(--space-1) 0 0" }}>{t("headlinePlaceholder")}</p>
          )}
          {location ? (
            <p style={{ font: "var(--text-body-sm)", color: "var(--text-tertiary)", margin: "var(--space-1) 0 0" }}>{location}</p>
          ) : (
            <p style={{ font: "var(--text-body-sm)", color: "var(--text-tertiary)", fontStyle: "italic", margin: "var(--space-1) 0 0" }}>{t("locationPlaceholder")}</p>
          )}
        </div>
        <EditPencilButton label={t("editIdentity")} onClick={() => setIsEditing(true)} />
      </div>
    );
  }

  return (
    <form key={formKey} action={formAction} style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)", maxWidth: 400 }}>
      {/* The name limit note appears as soon as the identity editor opens
          — the name is public, indexed, and shown on reviews, so its
          change budget is worth stating up front, not after a failed save. */}
      {nameUsage && <RenameLimitNote usage={nameUsage} kind="name" />}
      <label>
        {t("displayNameLabel")}
        <input name="displayName" type="text" defaultValue={state?.values?.displayName ?? displayName} maxLength={MAX_DISPLAY_NAME_LENGTH} className="form-field" style={{ width: "100%" }} />
      </label>
      <label>
        {t("headlineLabel")}
        <input name="headline" type="text" defaultValue={state?.values?.headline ?? headline} maxLength={MAX_HEADLINE_LENGTH} className="form-field" style={{ width: "100%" }} />
      </label>
      <label>
        {t("locationLabel")}
        <input name="location" type="text" defaultValue={state?.values?.location ?? location} maxLength={MAX_LOCATION_LENGTH} className="form-field" style={{ width: "100%" }} />
      </label>
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
