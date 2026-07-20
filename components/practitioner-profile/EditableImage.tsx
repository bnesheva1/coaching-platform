"use client";

import { useActionState, useRef } from "react";
import { uploadProfileImage, type ProfileFormState } from "@/app/[locale]/practitioner-dashboard/actions";
import { EditPencilButton } from "./EditPencilButton";

const initialState: ProfileFormState = null;

// Pencil click opens the browser's native file picker directly and
// uploads on selection — no modal. Simpler than the design source (which
// left banner/avatar pencils as unwired stubs) and matches how photo
// upload already worked in the old ProfileForm, just triggered by a
// pencil instead of a visible file input.
export function EditableImage({
  kind,
  label,
  children,
}: {
  kind: "avatar" | "banner";
  label: string;
  children: React.ReactNode;
}) {
  const [state, formAction] = useActionState(uploadProfileImage.bind(null, kind), initialState);
  const formRef = useRef<HTMLFormElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

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
      <EditPencilButton
        label={label}
        size={kind === "banner" ? 32 : 26}
        onClick={() => inputRef.current?.click()}
      />
      {state?.error && (
        <p role="alert" style={{ position: "absolute", font: "var(--text-caption)", color: "crimson", background: "var(--bg-surface)", padding: "var(--space-1) var(--space-2)", borderRadius: "var(--radius-sm)", marginTop: 4 }}>
          {state.error}
        </p>
      )}
    </>
  );
}
