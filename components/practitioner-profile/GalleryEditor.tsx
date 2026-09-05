"use client";

import { useActionState, useRef, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/Button";
import {
  addGalleryImage,
  updateGalleryCaption,
  removeGalleryImage,
  type ProfileFormState,
} from "@/app/[locale]/practitioner-dashboard/actions";
import { RemoveImageButton } from "./RemoveImageButton";

const initialState: ProfileFormState = null;

// Mirrors MAX_GALLERY_IMAGES / MAX_GALLERY_CAPTION_LENGTH in actions.ts — the
// server (and, for the count, a DB trigger) is authoritative; these just keep
// the UI honest, same duplicate-the-constant pattern as EditableAbout's
// MAX_BIO_LENGTH.
const MAX_IMAGES = 3;
const MAX_CAPTION = 100;

export type GalleryImage = { id: string; imageUrl: string; caption: string | null };

const tileWidth = 190;

// Owner-only gallery management, rendered in the profile's edit mode right after
// the About editor. Each existing image is a tile with an inline caption editor
// and a remove control; a dashed "add" tile appears while under the 3-image cap.
export function GalleryEditor({ gallery }: { gallery: GalleryImage[] }) {
  const t = useTranslations("Profile");
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 16, alignItems: "flex-start" }}>
      {gallery.map((img) => (
        <GalleryItem key={img.id} img={img} />
      ))}
      {gallery.length < MAX_IMAGES && <GalleryAdd />}
      {gallery.length === 0 && (
        <p style={{ margin: 0, alignSelf: "center", font: "var(--text-body-sm)", color: "var(--text-tertiary)" }}>
          {t("galleryEmptyOwner")}
        </p>
      )}
    </div>
  );
}

function GalleryItem({ img }: { img: GalleryImage }) {
  const t = useTranslations("Profile");
  const [state, formAction, pending] = useActionState(updateGalleryCaption.bind(null, img.id), initialState);
  const [isRemoving, startRemove] = useTransition();
  const [caption, setCaption] = useState(img.caption ?? "");
  const dirty = caption.trim() !== (img.caption ?? "");

  return (
    <div style={{ width: tileWidth, display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ position: "relative", width: "100%", aspectRatio: "1 / 1", borderRadius: 12, overflow: "hidden", boxShadow: "var(--shadow-sm)" }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={img.imageUrl} alt={img.caption ?? ""} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
        <div style={{ position: "absolute", top: 6, right: 6 }}>
          <RemoveImageButton
            label={t("galleryRemove")}
            size={28}
            onClick={() => {
              if (isRemoving) return;
              startRemove(async () => {
                await removeGalleryImage(img.id);
              });
            }}
          />
        </div>
      </div>
      <form action={formAction} style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <input
          name="caption"
          value={caption}
          onChange={(e) => setCaption(e.target.value)}
          maxLength={MAX_CAPTION}
          placeholder={t("galleryCaptionPlaceholder")}
          className="form-field"
          style={{ width: "100%", font: "var(--text-body-sm)" }}
        />
        {dirty && (
          <Button type="submit" size="sm" variant="secondary" disabled={pending}>
            {pending ? t("saveButtonPending") : t("galleryCaptionSave")}
          </Button>
        )}
        {state?.error && <p style={{ margin: 0, font: "var(--text-caption)", color: "var(--color-danger)" }}>{state.error}</p>}
      </form>
    </div>
  );
}

function GalleryAdd() {
  const t = useTranslations("Profile");
  const [state, formAction, pending] = useActionState(addGalleryImage, initialState);
  const formRef = useRef<HTMLFormElement>(null);
  // Re-key the form after a completed action so React 19's post-action reset
  // fully clears the file + caption inputs (same remount trick the other
  // profile forms use); bumped whenever the returned state identity changes.
  const [prevState, setPrevState] = useState(state);
  const [formKey, setFormKey] = useState(0);
  if (state !== prevState) {
    setPrevState(state);
    setFormKey((k) => k + 1);
  }

  return (
    <form
      key={formKey}
      ref={formRef}
      action={formAction}
      style={{
        width: tileWidth,
        display: "flex",
        flexDirection: "column",
        gap: 8,
        padding: 12,
        border: "1px dashed var(--border-default)",
        borderRadius: 12,
      }}
    >
      <input
        type="file"
        name="image"
        accept="image/png,image/jpeg,image/webp"
        required
        style={{ font: "var(--text-caption)", color: "var(--text-secondary)" }}
      />
      <input
        name="caption"
        maxLength={MAX_CAPTION}
        placeholder={t("galleryCaptionPlaceholder")}
        className="form-field"
        style={{ width: "100%", font: "var(--text-body-sm)" }}
      />
      <Button type="submit" size="sm" disabled={pending}>
        {pending ? t("saveButtonPending") : t("galleryAdd")}
      </Button>
      {state?.error && <p style={{ margin: 0, font: "var(--text-caption)", color: "var(--color-danger)" }}>{state.error}</p>}
    </form>
  );
}
