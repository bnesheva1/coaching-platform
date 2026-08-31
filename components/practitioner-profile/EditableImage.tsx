"use client";

import { useActionState, useRef, useTransition } from "react";
import { uploadProfileImage, removeProfileImage, type ProfileFormState } from "@/app/[locale]/practitioner-dashboard/actions";
import { EditPencilButton } from "./EditPencilButton";
import { RemoveImageButton } from "./RemoveImageButton";

const initialState: ProfileFormState = null;

// Pencil click opens the browser's native file picker directly and
// uploads on selection — no modal. Simpler than the design source (which
// left banner/avatar pencils as unwired stubs) and matches how photo
// upload already worked in the old ProfileForm, just triggered by a
// pencil instead of a visible file input.
//
// Remove sits beside the pencil (only shown when hasImage — there's
// nothing to clear on a profile that's never had one) and fires
// immediately, same "no confirmation, no modal" spirit as upload —
// re-uploading is always one click away, so this isn't destructive
// enough to warrant a dialog the way deleting a service is.
export function EditableImage({
  kind,
  label,
  removeLabel,
  hasImage,
  children,
}: {
  kind: "avatar" | "banner";
  label: string;
  removeLabel: string;
  hasImage: boolean;
  children: React.ReactNode;
}) {
  const [state, formAction] = useActionState(uploadProfileImage.bind(null, kind), initialState);
  const formRef = useRef<HTMLFormElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [isRemoving, startRemoveTransition] = useTransition();

  return (
    <>
      {children}
      <form ref={formRef} action={formAction} style={{ display: "none" }}>
        <input
          ref={inputRef}
          type="file"
          name="image"
          accept="image/png,image/jpeg,image/webp"
          onChange={() => formRef.current?.requestSubmit()}
        />
      </form>
      <div style={{ display: "flex", gap: 4 }}>
        <EditPencilButton
          label={label}
          size={kind === "banner" ? 32 : 26}
          onClick={() => inputRef.current?.click()}
        />
        {hasImage && (
          <RemoveImageButton
            label={removeLabel}
            size={kind === "banner" ? 32 : 26}
            onClick={() => {
              if (isRemoving) return;
              startRemoveTransition(async () => {
                await removeProfileImage(kind);
              });
            }}
          />
        )}
      </div>
      {state?.error && (
        <p role="alert" style={{ position: "absolute", font: "var(--text-caption)", color: "var(--color-danger)", background: "var(--bg-surface)", padding: "var(--space-1) var(--space-2)", borderRadius: "var(--radius-sm)", marginTop: 4 }}>
          {state.error}
        </p>
      )}
    </>
  );
}
