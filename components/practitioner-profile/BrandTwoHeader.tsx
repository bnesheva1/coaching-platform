"use client";

import { useLocale, useTranslations } from "next-intl";
import { Star, Clock, CalendarDays, CircleEuro } from "lucide-react";
import type { RenameUsage } from "@/lib/rename-limits";
import { SaveButton } from "@/components/practitioners/SaveButton";
import { EditableImage } from "./EditableImage";
import { EditableIdentity } from "./EditableIdentity";
import { EditableSpecialties } from "./EditableSpecialties";
import { EditableTopics } from "./EditableTopics";
import specialtiesData from "@/data/specialties.json";
import topicsData from "@/data/topics.json";
import domainsData from "@/data/domains.json";
import styles from "./BrandTwoHeader.module.css";

export type BrandTwoHeaderProps = {
  isEditing: boolean;
  displayName: string;
  headline: string;
  bio: string;
  quote: string;
  location: string;
  avatarUrl: string | null;
  specialties: string[];
  topics: string[];
  domain: string | null;
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

// Brand-two profile header (design handoff 1f): a summary CARD on the left
// (browse-card styling, profile content) beside the content column. Only
// rendered when the active brand is "two"; brand one keeps its own header.
export function BrandTwoHeader(props: BrandTwoHeaderProps) {
  const { isEditing } = props;
  const t = useTranslations("Profile");
  const tPublic = useTranslations("PublicProfile");
  const locale = useLocale();

  const specialtyLabel = (key: string) =>
    specialtiesData.find((s) => s.key === key)?.[locale as "en" | "bg"] ?? key;
  const topicLabel = (key: string) => topicsData.find((x) => x.key === key)?.[locale as "en" | "bg"] ?? key;
  const domainLabel = (key: string) => domainsData.find((d) => d.key === key)?.[locale as "en" | "bg"] ?? key;
  const specialtyText = props.specialties.map(specialtyLabel).join(", ");

  const priceText =
    props.minPriceCents != null && props.currency
      ? new Intl.NumberFormat(props.intlLocale, { style: "currency", currency: props.currency, maximumFractionDigits: 0 }).format(
          props.minPriceCents / 100,
        )
      : null;
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
        <EditableSpecialties specialties={props.specialties} domain={props.domain} />
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
        <div className={styles.cardMeta}>
          <div className={styles.cardMetaRow}>
            <Clock size={24} strokeWidth={1.8} className={styles.pillIcon} aria-hidden="true" />
            <span className={styles.cardMetaText}>
              <span className={styles.cardMetaLabel}>{tPublic("nextAvailableSlotLabel")}</span>
              <span className={styles.cardMetaValue}>{props.nextSlotLabel ?? tPublic("nextAvailableSlotEmpty")}</span>
            </span>
          </div>
          {priceText && (
            <div className={styles.cardMetaRow}>
              <CircleEuro size={24} strokeWidth={1.8} className={styles.pillIcon} aria-hidden="true" />
              <span className={styles.cardMetaValue}>{tPublic("summaryPriceFrom", { price: priceText })}</span>
            </div>
          )}
        </div>
        <button type="button" className={styles.cardCta} onClick={props.onSeeAvailability}>
          <CalendarDays size={17} strokeWidth={1.8} aria-hidden="true" />
          {t("seeAvailability")}
        </button>
      </div>

      {/* Right: content column. Domain pill (accent) sits ABOVE the headline;
          the bordered topic pills moved to BELOW it. Each row only renders when
          it has content, so a practitioner with no domain/topics shows neither. */}
      <div className={styles.contentCol}>
        {props.domain && <span className={styles.domainPill}>{domainLabel(props.domain)}</span>}
        {props.headline && <h2 className={styles.headline}>{props.headline}</h2>}
        {props.topics.length > 0 && (
          <div className={styles.topicPills}>
            <span className={styles.topicPillsLabel}>{t("topicsLabel")}</span>
            {props.topics.map((key) => (
              <span key={key} className={styles.topicPill}>
                {topicLabel(key)}
              </span>
            ))}
          </div>
        )}
        {showSave && (
          <div className={styles.factRow}>
            <SaveButton
              practitionerId={props.practitionerId}
              username={props.username ?? ""}
              initialSaved={props.viewerHasSaved}
              viewerIsGuest={props.viewerRole === null}
              variant="full"
            />
          </div>
        )}
        {/* About — lives here (not in a separate section below) so the left
            card can stay sticky over the whole header+about run, down to
            Services. */}
        <div className={styles.about}>
          <h2 className={styles.aboutHeading}>{t("aboutHeading")}</h2>
          {props.bio ? (
            props.bio.split("\n\n").map((paragraph, i) => (
              <p key={i} className={styles.aboutPara}>
                {paragraph}
              </p>
            ))
          ) : (
            <p className={styles.aboutEmpty}>{t("aboutEmpty")}</p>
          )}
          {props.quote && (
            <blockquote className={styles.quote}>
              &bdquo;{props.quote}&ldquo;
              <div className={styles.quoteBy}>&mdash; {props.displayName}</div>
            </blockquote>
          )}
        </div>
      </div>
    </div>
  );
}
