"use client";

import { Star } from "lucide-react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { SaveButton } from "@/components/practitioners/SaveButton";
import styles from "./BrowseTwo.module.css";

export type BrowseCardTwoData = {
  id: string;
  username: string;
  displayName: string | null;
  bio: string | null;
  avatarUrl: string | null;
  specialtyLabels: string[];
  topicLabels: string[];
  averageRating: number | null;
  location: string | null;
};

// Brand-two browse result card (handoff 1g): heart (left) + rating badge (right)
// on top, centred portrait/name/practice/location/topics/bio, "Запази час" link
// in a hairline footer. Reuses SaveButton (compact heart) and the Browse i18n.
export function BrowseCardTwo({
  practitioner,
  saveable,
  saved,
  viewerIsGuest,
  onToggleSave,
}: {
  practitioner: BrowseCardTwoData;
  saveable: boolean;
  saved: boolean;
  viewerIsGuest: boolean;
  onToggleSave: (saved: boolean) => void;
}) {
  const t = useTranslations("Browse");
  const name = practitioner.displayName || `@${practitioner.username}`;

  return (
    <div className={styles.card}>
      <div className={styles.cardTop}>
        {saveable ? (
          <SaveButton
            practitionerId={practitioner.id}
            username={practitioner.username}
            initialSaved={saved}
            viewerIsGuest={viewerIsGuest}
            variant="compact"
            onToggle={onToggleSave}
          />
        ) : (
          <span />
        )}
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
          <span className={styles.practice}>{practitioner.specialtyLabels.join(", ")}</span>
        )}
        {practitioner.location && <span className={styles.location}>{practitioner.location}</span>}
        {practitioner.topicLabels.length > 0 && (
          <span className={styles.chips}>
            {practitioner.topicLabels.slice(0, 3).map((label) => (
              <span key={label} className={styles.chip}>
                {label}
              </span>
            ))}
          </span>
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
