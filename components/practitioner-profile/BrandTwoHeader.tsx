"use client";

import { useLocale, useTranslations } from "next-intl";
import { Star, MapPin, Clock, CalendarDays } from "lucide-react";
import type { RenameUsage } from "@/lib/rename-limits";
import { SaveButton } from "@/components/practitioners/SaveButton";
import { EditableImage } from "./EditableImage";
import { EditableIdentity } from "./EditableIdentity";
import { EditableSpecialties } from "./EditableSpecialties";
import { EditableTopics } from "./EditableTopics";
import specialtiesData from "@/data/specialties.json";
import topicsData from "@/data/topics.json";
import styles from "./BrandTwoHeader.module.css";

export type BrandTwoHeaderProps = {
  isEditing: boolean;
  displayName: string;
  headline: string;
  bio: string;
  location: string;
  avatarUrl: string | null;
  specialties: string[];
  topics: string[];
  nameUsage?: RenameUsage;
  availableNow: boolean;
  averageRating: number | null;
  reviewCount: number;
  minPriceCents: number | null;
  currency: string | null;
  nextSlotLabel: string | null;
  timezone: string;
  practitionerId: string;
  username: string | null;
  viewerRole: "client" | "practitioner" | null;
  isOwnProfile: boolean;
  viewerHasSaved: boolean;
  onSeeAvailability: () => void;
  intlLocale: string;
};

// Header teaser — trims the bio to a short intro at a word boundary.
function truncate(text: string, max: number): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max);
  const lastSpace = cut.lastIndexOf(" ");
  return `${cut.slice(0, lastSpace > 40 ? lastSpace : max).trim()}…`;
}

// Brand-two profile header (design handoff 1f): a summary CARD on the left
// (browse-card styling, profile content) beside the content column. Only
// rendered when the active brand is "two"; brand one keeps its own header.
export function BrandTwoHeader(props: BrandTwoHeaderProps) {
  const { isEditing } = props;
  const t = useTranslations("Profile");
  const tPublic = useTranslations("PublicProfile");
  const tImmediate = useTranslations("Immediate");
  const locale = useLocale();

  const specialtyLabel = (key: string) =>
    specialtiesData.find((s) => s.key === key)?.[locale as "en" | "bg"] ?? key;
  const topicLabel = (key: string) => topicsData.find((x) => x.key === key)?.[locale as "en" | "bg"] ?? key;
  const specialtyText = props.specialties.map(specialtyLabel).join(", ");

  const priceText =
    props.minPriceCents != null && props.currency
      ? new Intl.NumberFormat(props.intlLocale, { style: "currency", currency: props.currency, maximumFractionDigits: 0 }).format(
          props.minPriceCents / 100,
        )
      : null;
  const introText = props.bio ? truncate(props.bio, 190) : "";
  const showSave = !props.isOwnProfile && props.viewerRole !== "practitioner";

  const avatar = props.avatarUrl ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img className={styles.portrait} src={props.avatarUrl} alt={props.displayName} />
  ) : (
    <div className={styles.portraitFallback}>{props.displayName.charAt(0).toUpperCase()}</div>
  );

  // Edit mode: no card — just the editable pieces stacked.
  if (isEditing) {
    return (
      <div className={styles.editStack}>
        <div style={{ position: "relative", width: 104, height: 104 }}>
          {avatar}
          <div style={{ position: "absolute", bottom: 0, right: 0 }}>
            <EditableImage kind="avatar" label={t("editPhoto")} removeLabel={t("removePhoto")} hasImage={!!props.avatarUrl}>
              <></>
            </EditableImage>
          </div>
        </div>
        <EditableIdentity displayName={props.displayName} headline={props.headline} location={props.location} nameUsage={props.nameUsage} />
        <EditableSpecialties specialties={props.specialties} />
        <EditableTopics topics={props.topics} />
      </div>
    );
  }

  return (
    <div className={styles.headerGrid}>
      {/* Left: summary card */}
      <div className={styles.card}>
        {props.averageRating !== null && (
          <span className={styles.ratingPill}>
            <Star size={12} fill="currentColor" strokeWidth={0} aria-hidden="true" />
            {props.averageRating.toFixed(1)}
          </span>
        )}
        <div className={styles.portraitWrap}>
          {avatar}
          {props.availableNow && <span className={styles.availDot} aria-hidden="true" />}
        </div>
        <h1 className={styles.cardName}>{props.displayName}</h1>
        {props.specialties.length > 0 && <span className={styles.cardPractice}>{specialtyText}</span>}
        <div className={styles.cardDivider} />
        {priceText && (
          <span className={styles.cardPrice}>
            <Clock size={15} className={styles.pillIcon} aria-hidden="true" />
            {tPublic("summaryPriceFrom", { price: priceText })}
          </span>
        )}
        <button type="button" className={styles.cardCta} onClick={props.onSeeAvailability}>
          <CalendarDays size={17} strokeWidth={1.8} aria-hidden="true" />
          {t("bookNowCta")}
        </button>
      </div>

      {/* Right: content column */}
      <div className={styles.contentCol}>
        {props.topics.length > 0 && (
          <div className={styles.topicPills}>
            {props.topics.map((key) => (
              <span key={key} className={styles.topicPill}>
                {topicLabel(key)}
              </span>
            ))}
          </div>
        )}
        {props.headline && <h2 className={styles.headline}>{props.headline}</h2>}
        <div className={styles.factRow}>
          {props.specialties.length > 0 && (
            <span className={styles.factPill}>
              <MapPin size={16} strokeWidth={1.8} className={styles.pillIcon} aria-hidden="true" />
              {specialtyText}
            </span>
          )}
          <span className={styles.factPill}>
            <Clock size={16} strokeWidth={1.8} className={styles.pillIcon} aria-hidden="true" />
            <span className={styles.factPillText}>
              <span className={styles.factLabel}>{tPublic("nextAvailableSlotLabel")}</span>
              <span className={styles.factValue}>{props.nextSlotLabel ?? tPublic("nextAvailableSlotEmpty")}</span>
            </span>
          </span>
          {showSave && (
            <SaveButton
              practitionerId={props.practitionerId}
              username={props.username ?? ""}
              initialSaved={props.viewerHasSaved}
              viewerIsGuest={props.viewerRole === null}
              variant="full"
            />
          )}
        </div>
        {introText && <p className={styles.intro}>{introText}</p>}
      </div>
    </div>
  );
}
