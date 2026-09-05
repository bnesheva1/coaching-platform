"use client";

import { useActionState, useRef, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/Button";
import { addGalleryImage, removeGalleryImage, type ProfileFormState } from "@/app/[locale]/practitioner-dashboard/actions";
import { RemoveImageButton } from "./RemoveImageButton";
import { MediaModal, type MediaItem } from "./MediaModal";
import styles from "./MediaSection.module.css";

const initialState: ProfileFormState = null;
const MAX_IMAGES = 9; // mirrors MAX_GALLERY_IMAGES in actions.ts (DB trigger is authoritative)

export type GalleryImage = { id: string; url: string };

// Gallery section: 16:9 thumbnails in the shared 3/2/1 grid; clicking opens the
// shared MediaModal as a lightbox (prev/next wrap, arrows, swipe). In edit mode
// each tile gets a remove control and a dashed upload tile appears under the cap.
// Self-omits on the public view when empty.
export function GallerySection({ images, isEditing }: { images: GalleryImage[]; isEditing: boolean }) {
  const t = useTranslations("Profile");
  const [open, setOpen] = useState(false);
  const [index, setIndex] = useState(0);

  if (!isEditing && images.length === 0) return null;

  const items: MediaItem[] = images.map((im) => ({ type: "image", src: im.url }));

  return (
    <section>
      <h2 style={{ margin: "0 0 12px", font: "var(--text-heading-lg)", color: "var(--text-primary)" }}>{t("galleryHeading")}</h2>
      {isEditing && images.length === 0 && (
        <p style={{ margin: "0 0 12px", font: "var(--text-body-sm)", color: "var(--text-tertiary)" }}>{t("galleryEmptyOwner")}</p>
      )}
      <div className={styles.grid}>
        {images.map((im, i) => (
          <div key={im.id} className={styles.item}>
            <button type="button" className={styles.tile} onClick={() => { setIndex(i); setOpen(true); }} aria-label={t("galleryOpenImage")}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img className={styles.thumb} src={im.url} alt="" />
            </button>
            {isEditing && <GalleryRemove id={im.id} />}
          </div>
        ))}
        {isEditing && images.length < MAX_IMAGES && <GalleryAddTile />}
      </div>
      <MediaModal items={items} index={index} open={open} onClose={() => setOpen(false)} onIndexChange={setIndex} />
    </section>
  );
}

function GalleryRemove({ id }: { id: string }) {
  const t = useTranslations("Profile");
  const [pending, start] = useTransition();
  return (
    <div className={styles.removeBtn}>
      <RemoveImageButton
        label={t("galleryRemove")}
        size={28}
        onClick={() => {
          if (pending) return;
          start(async () => {
            await removeGalleryImage(id);
          });
        }}
      />
    </div>
  );
}

function GalleryAddTile() {
  const t = useTranslations("Profile");
  const [state, formAction, pending] = useActionState(addGalleryImage, initialState);
  const formRef = useRef<HTMLFormElement>(null);
  // Re-key after each completed action so React 19's post-action reset fully
  // clears the file input (same remount trick the other profile forms use).
  const [prevState, setPrevState] = useState(state);
  const [formKey, setFormKey] = useState(0);
  if (state !== prevState) {
    setPrevState(state);
    setFormKey((k) => k + 1);
  }
  return (
    <form key={formKey} ref={formRef} action={formAction} className={styles.addTile}>
      <input type="file" name="image" accept="image/png,image/jpeg,image/webp" required style={{ font: "var(--text-caption)", color: "var(--text-secondary)" }} />
      <Button type="submit" size="sm" disabled={pending}>
        {pending ? t("saveButtonPending") : t("galleryAdd")}
      </Button>
      {state?.error && <p className={styles.error}>{state.error}</p>}
    </form>
  );
}
