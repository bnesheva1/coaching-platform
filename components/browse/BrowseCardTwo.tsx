"use client";

import type { ReactNode } from "react";
import { Star } from "lucide-react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { initialsFromName } from "@/lib/initials";
import styles from "./BrowseTwo.module.css";

export type BrowseCardTwoData = {
  id: string;
  username: string;
  displayName: string | null;
  bio: string | null;
  avatarUrl: string | null;
  specialtyLabels: string[];
  averageRating: number | null;
};

// Brand-two practitioner card (browse handoff 1g), reused on the client dashboard.
// The whole card links to the profile via a stretched-link overlay, so an optional
// save heart (`saveControl`, a sibling above the overlay) stays independently
// clickable. `elevated` swaps the hover-border treatment for a persistent drop
// shadow (the dashboard's preference).
export function BrowseCardTwo({
  practitioner,
  elevated = false,
  saveControl,
}: {
  practitioner: BrowseCardTwoData;
  elevated?: boolean;
  saveControl?: ReactNode;
}) {
  const t = useTranslations("Browse");
  const tA = useTranslations("A11y");
  const name = practitioner.displayName || `@${practitioner.username}`;

  return (
    <div className={`${styles.card}${elevated ? ` ${styles.cardElevated}` : ""}`}>
      <Link href={`/p/${practitioner.username}`} className={styles.cardLinkOverlay} aria-label={name} />

      <div className={styles.cardTop}>
        {practitioner.averageRating !== null ? (
          <span className={styles.ratingPill}>
            <Star size={12} fill="currentColor" strokeWidth={0} aria-hidden="true" />
            {practitioner.averageRating.toFixed(1)}
          </span>
        ) : (
          <span className={styles.ratingNew}>{t("browseTwoNewProfile")}</span>
        )}
      </div>

      <div className={styles.cardBody}>
        {practitioner.avatarUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img className={styles.portrait} src={practitioner.avatarUrl} alt={tA("avatarAlt", { name })} />
        ) : (
          <span className={styles.portraitFallback} aria-hidden="true">
            {initialsFromName(name)}
          </span>
        )}
        <p className={styles.name}>{name}</p>
        {practitioner.specialtyLabels.length > 0 && (
          <span className={styles.practice}>{practitioner.specialtyLabels.join(" · ")}</span>
        )}
        {practitioner.bio && <span className={styles.bio}>{practitioner.bio}</span>}
      </div>

      <div className={styles.cardFooter}>
        <span className={styles.bookLink}>{t("bookSessionCta")}</span>
      </div>

      {saveControl}
    </div>
  );
}
