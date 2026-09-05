"use client";

import { Star } from "lucide-react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
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

// Brand-two browse result card (handoff 1g). The ENTIRE card is the link to the
// practitioner's profile (browse-only behaviour); "Запази час" stays as text in
// the footer, not a separate anchor (nested anchors are invalid). White border
// at rest → black + shadow on hover.
export function BrowseCardTwo({ practitioner }: { practitioner: BrowseCardTwoData }) {
  const t = useTranslations("Browse");
  const name = practitioner.displayName || `@${practitioner.username}`;

  return (
    <Link href={`/p/${practitioner.username}`} className={styles.card}>
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
          <img className={styles.portrait} src={practitioner.avatarUrl} alt="" />
        ) : (
          <span className={styles.portraitFallback} aria-hidden="true">
            {name.charAt(0).toUpperCase()}
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
    </Link>
  );
}
