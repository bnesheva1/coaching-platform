"use client";

import { useActionState, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/Button";
import { addVideo, removeVideo, type ProfileFormState } from "@/app/[locale]/practitioner-dashboard/actions";
import { buildEmbedUrl, type VideoPlatform } from "@/lib/videos";
import { RemoveImageButton } from "./RemoveImageButton";
import { MediaModal, type MediaItem } from "./MediaModal";
import styles from "./MediaSection.module.css";

const initialState: ProfileFormState = null;
const MAX_VIDEOS = 9; // mirrors MAX_VIDEOS in actions.ts (DB trigger is authoritative)

export type ProfileVideo = {
  id: string;
  platform: VideoPlatform;
  videoId: string;
  title: string | null;
  thumbnailUrl: string | null;
};

// Videos section: thumbnail cards with a play overlay in the shared 3/2/1 grid.
// Clicking a card opens the shared MediaModal in iframe mode with an app-built
// embed URL. In edit mode each card gets a remove control; a paste-URL tile
// appears under the cap, replaced by a clear "remove one to add another" message
// once 9 exist. Self-omits on the public view when empty.
export function VideosSection({ videos, isEditing }: { videos: ProfileVideo[]; isEditing: boolean }) {
  const t = useTranslations("Profile");
  const [active, setActive] = useState<ProfileVideo | null>(null);

  if (!isEditing && videos.length === 0) return null;

  // Single-item modal per opened video (no cycling — matches "clicking opens
  // that embed"); the shared modal hides its arrows when there's one item.
  const items: MediaItem[] = active
    ? [{ type: "iframe", src: buildEmbedUrl(active.platform, active.videoId), title: active.title ?? "video" }]
    : [];

  return (
    <section>
      <h2 style={{ margin: "0 0 12px", font: "var(--text-heading-lg)", color: "var(--text-primary)" }}>{t("videosHeading")}</h2>
      {isEditing && videos.length === 0 && (
        <p style={{ margin: "0 0 12px", font: "var(--text-body-sm)", color: "var(--text-tertiary)" }}>{t("videosEmptyOwner")}</p>
      )}
      <div className={styles.grid}>
        {videos.map((v) => (
          <div key={v.id} className={styles.item}>
            <button type="button" className={styles.tile} onClick={() => setActive(v)} aria-label={t("videoPlay", { title: v.title ?? "" })}>
              {v.thumbnailUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img className={styles.thumb} src={v.thumbnailUrl} alt="" />
              ) : (
                <span className={styles.thumb} style={{ background: "var(--bg-surface-2)" }} />
              )}
              <span className={styles.playOverlay}>
                <span className={styles.playIcon}>
                  <PlayGlyph />
                </span>
              </span>
            </button>
            {v.title && <p className={styles.videoTitle}>{v.title}</p>}
            {isEditing && <VideoRemove id={v.id} />}
          </div>
        ))}
        {isEditing && videos.length < MAX_VIDEOS && <VideoAddTile />}
        {isEditing && videos.length >= MAX_VIDEOS && (
          <div className={styles.addTile}>
            <p style={{ margin: 0, font: "var(--text-body-sm)", color: "var(--text-secondary)" }}>{t("videoLimitReachedHint", { max: MAX_VIDEOS })}</p>
          </div>
        )}
      </div>
      <MediaModal items={items} index={0} open={active !== null} onClose={() => setActive(null)} onIndexChange={() => {}} />
    </section>
  );
}

function VideoRemove({ id }: { id: string }) {
  const t = useTranslations("Profile");
  const [pending, start] = useTransition();
  return (
    <div className={styles.removeBtn}>
      <RemoveImageButton
        label={t("videoRemove")}
        size={28}
        onClick={() => {
          if (pending) return;
          start(async () => {
            await removeVideo(id);
          });
        }}
      />
    </div>
  );
}

function VideoAddTile() {
  const t = useTranslations("Profile");
  const [state, formAction, pending] = useActionState(addVideo, initialState);
  const [prevState, setPrevState] = useState(state);
  const [formKey, setFormKey] = useState(0);
  if (state !== prevState) {
    setPrevState(state);
    setFormKey((k) => k + 1);
  }
  return (
    <form key={formKey} action={formAction} className={styles.addTile}>
      <input
        type="url"
        name="url"
        required
        placeholder={t("videoUrlPlaceholder")}
        className="form-field"
        style={{ font: "var(--text-body-sm)" }}
      />
      <Button type="submit" size="sm" disabled={pending}>
        {pending ? t("saveButtonPending") : t("videoAdd")}
      </Button>
      {state?.error && <p className={styles.error}>{state.error}</p>}
    </form>
  );
}

function PlayGlyph() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M8 5v14l11-7z" />
    </svg>
  );
}
