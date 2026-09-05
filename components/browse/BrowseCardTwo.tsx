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

// Brand-two browse result card (handoff 1g): a white hairline card on the grey
// page. Rating pill (teal) or "нов профил" top-right; then a centred column —
// large circular portrait, bold name, teal practice line, 2-line bio — and a
// "Запази час" link in a hairline footer. No heart / location / topic chips
// (the mockup's cards don't carry them).
export function BrowseCardTwo({ practitioner }: { practitioner: BrowseCardTwoData }) {
  const t = useTranslations("Browse");
  const name = practitioner.displayName || `@${practitioner.username}`;

  return (
    <div className={styles.card}>
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

      <Link href={`/p/${practitioner.username}`} className={styles.cardBody} style={{ textDecoration: "none" }}>
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
      </Link>

      <div className={styles.cardFooter}>
        <Link href={`/p/${practitioner.username}`} className={styles.bookLink}>
          {t("bookSessionCta")}
        </Link>
      </div>
    </div>
  );
}
