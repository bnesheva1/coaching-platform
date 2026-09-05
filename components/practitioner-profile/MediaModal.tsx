"use client";

import { useEffect, useRef } from "react";
import { useTranslations } from "next-intl";
import styles from "./MediaModal.module.css";

// One item shown in the lightbox — an image (Gallery) or an embedded video
// iframe (Videos). The section decides which; the modal renders either.
export type MediaItem =
  | { type: "image"; src: string; alt?: string }
  | { type: "iframe"; src: string; title?: string };

// Shared lightbox for both sections. Controlled: the parent owns open/index and
// receives navigation + close callbacks, so the SAME keyboard/swipe/focus-trap
// behaviour is used everywhere (image and iframe alike). Prev/next wrap around
// and only render when there's more than one item (single-video opens don't get
// arrows). Focus trap + focus restore + Escape are native <dialog> behaviour.
export function MediaModal({
  items,
  index,
  open,
  onClose,
  onIndexChange,
}: {
  items: MediaItem[];
  index: number;
  open: boolean;
  onClose: () => void;
  onIndexChange: (next: number) => void;
}) {
  const t = useTranslations("Profile");
  const dialogRef = useRef<HTMLDialogElement>(null);
  const touchStartX = useRef<number | null>(null);

  const count = items.length;
  const canCycle = count > 1;

  // Sync the native dialog with the controlled `open` prop.
  useEffect(() => {
    const d = dialogRef.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    else if (!open && d.open) d.close();
  }, [open]);

  // Left/right arrows navigate while open (Escape is handled by <dialog>). Kept
  // in an effect (not just onKeyDown) so it works regardless of focus target
  // inside the dialog. Depends on index so the wrap maths uses the current one.
  useEffect(() => {
    if (!open || !canCycle) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        onIndexChange((index - 1 + count) % count);
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        onIndexChange((index + 1) % count);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, canCycle, index, count, onIndexChange]);

  const item = items[index];
  const go = (delta: number) => onIndexChange((index + delta + count) % count);

  return (
    <dialog
      ref={dialogRef}
      className={styles.dialog}
      // Fires on Escape (via cancel) and on programmatic close(); parent state
      // update is idempotent, so a redundant call is harmless.
      onClose={onClose}
      onCancel={onClose}
      onClick={(e) => {
        // A click on the <dialog> element itself is the backdrop (the frame
        // below stops propagation of clicks on the media/controls).
        if (e.target === dialogRef.current) onClose();
      }}
      onTouchStart={(e) => {
        touchStartX.current = e.touches[0]?.clientX ?? null;
      }}
      onTouchEnd={(e) => {
        if (touchStartX.current == null || !canCycle) return;
        const dx = (e.changedTouches[0]?.clientX ?? 0) - touchStartX.current;
        if (Math.abs(dx) > 40) go(dx < 0 ? 1 : -1);
        touchStartX.current = null;
      }}
    >
      {item && (
        <div className={styles.frame} onClick={(e) => e.stopPropagation()}>
          <button type="button" className={`${styles.control} ${styles.close}`} onClick={onClose} aria-label={t("mediaClose")}>
            ×
          </button>
          {canCycle && (
            <button type="button" className={`${styles.control} ${styles.nav} ${styles.prev}`} onClick={() => go(-1)} aria-label={t("mediaPrev")}>
              ‹
            </button>
          )}
          {item.type === "image" ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img className={styles.image} src={item.src} alt={item.alt ?? ""} />
          ) : (
            <div className={styles.iframeWrap}>
              <iframe
                className={styles.iframe}
                src={item.src}
                title={item.title ?? "video"}
                // App-built embed URL only. Permissions Policy limited to the
                // player features it needs; NO allow-same-origin alongside
                // allow-scripts (that combo would let framed content escape the
                // sandbox), per the security requirement.
                allow="fullscreen; encrypted-media; picture-in-picture"
                allowFullScreen
                sandbox="allow-scripts allow-presentation allow-popups allow-popups-to-escape-sandbox"
                referrerPolicy="strict-origin-when-cross-origin"
                loading="lazy"
              />
            </div>
          )}
          {canCycle && (
            <button type="button" className={`${styles.control} ${styles.nav} ${styles.next}`} onClick={() => go(1)} aria-label={t("mediaNext")}>
              ›
            </button>
          )}
        </div>
      )}
    </dialog>
  );
}
