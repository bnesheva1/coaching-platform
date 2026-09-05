"use client";

import { useLocale, useTranslations } from "next-intl";
import type { RenameUsage } from "@/lib/rename-limits";
import { StarRating } from "@/components/ui/StarRating";
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

// Brand-two profile header (design handoff 1e): no cover banner, a persistent
// 2px availability rule down the left of the lead content, a dominant intro
// statement, and a hairline (no-fill/no-shadow) summary card. Only rendered when
// the active brand is "two"; brand one keeps its own cover-banner header.
export function BrandTwoHeader(props: BrandTwoHeaderProps) {
  const { isEditing } = props;
  const t = useTranslations("Profile");
  const locale = useLocale();

  const specialtyLabel = (key: string) =>
    specialtiesData.find((s) => s.key === key)?.[locale as "en" | "bg"] ?? key;
  const topicLabel = (key: string) => topicsData.find((x) => x.key === key)?.[locale as "en" | "bg"] ?? key;

  const avatar = props.avatarUrl ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img className={styles.portrait} src={props.avatarUrl} alt={props.displayName} />
  ) : (
    <div className={styles.portraitFallback}>{props.displayName.charAt(0).toUpperCase()}</div>
  );

  // Edit mode: no banner, no summary card — just the editable pieces stacked.
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
      <div className={`${styles.leadCol} ${props.availableNow ? styles.leadColAvailable : ""}`}>
        {props.availableNow && (
          <span className={styles.availRow}>
            <span className={styles.availDot} aria-hidden="true" />
            <AvailableNowLabel />
          </span>
        )}
        {avatar}
        <h1 className={styles.name}>{props.displayName}</h1>
        {props.specialties.length > 0 && (
          <span className={styles.practiceLine}>{props.specialties.map(specialtyLabel).join(", ")}</span>
        )}
        {props.headline && <p className={styles.intro}>{props.headline}</p>}
        {props.specialties.length > 0 && (
          <TagRow labelKey="practicesLabel" items={props.specialties.map(specialtyLabel)} />
        )}
        {props.topics.length > 0 && <TagRow labelKey="topicsLabel" items={props.topics.map(topicLabel)} />}
      </div>

      <SummaryCard {...props} />
    </div>
  );
}

function AvailableNowLabel() {
  const tImmediate = useTranslations("Immediate");
  return <>{tImmediate("availableNowLabel")}</>;
}

function TagRow({ labelKey, items }: { labelKey: "practicesLabel" | "topicsLabel"; items: string[] }) {
  const tPublic = useTranslations("PublicProfile");
  return (
    <div className={styles.tagRow}>
      <span className={styles.tagLabel}>{tPublic(labelKey)}</span>
      <div className={styles.chips}>
        {items.map((label) => (
          <span key={label} className={styles.chip}>
            {label}
          </span>
        ))}
      </div>
    </div>
  );
}

function SummaryCard(props: BrandTwoHeaderProps) {
  const t = useTranslations("Profile");
  const tPublic = useTranslations("PublicProfile");
  const priceText =
    props.minPriceCents != null && props.currency
      ? new Intl.NumberFormat(props.intlLocale, { style: "currency", currency: props.currency }).format(props.minPriceCents / 100)
      : null;
  const showSave = !props.isOwnProfile && props.viewerRole !== "practitioner";

  return (
    <div className={styles.card}>
      {showSave && (
        <div className={styles.heart}>
          <SaveButton
            practitionerId={props.practitionerId}
            username={props.username ?? ""}
            initialSaved={props.viewerHasSaved}
            viewerIsGuest={props.viewerRole === null}
            variant="compact"
          />
        </div>
      )}

      {props.averageRating !== null && (
        <div className={styles.cardTop}>
          <span aria-hidden="true" style={{ color: "var(--accent)" }}>
            <StarRating rating={5} size={15} />
          </span>
          <span className={styles.ratingVal}>{props.averageRating.toFixed(1)}</span>
        </div>
      )}

      <div className={styles.divider} />

      <div className={styles.rows}>
        <div className={styles.row}>
          <span className={styles.rowLabel}>{tPublic("summaryReviewsLabel")}</span>
          <span className={styles.rowValue}>{props.reviewCount}</span>
        </div>
        <div className={styles.row}>
          <span className={styles.rowLabel}>{tPublic("nextAvailableSlotLabel")}</span>
          <span className={styles.rowValue}>
            {props.nextSlotLabel ?? tPublic("nextAvailableSlotEmpty")}
            {props.nextSlotLabel && (
              <>
                <br />
                <span className={styles.rowValueMuted}>{props.timezone}</span>
              </>
            )}
          </span>
        </div>
        {priceText && (
          <div className={styles.row}>
            <span className={styles.rowLabel}>{tPublic("summaryPriceLabel")}</span>
            <span className={styles.rowValue}>{tPublic("summaryPriceFrom", { price: priceText })}</span>
          </div>
        )}
      </div>

      {/* Ink CTA (not accent): inverse of the page — dark fill on light, light
          fill on dark — using the primary text/bg tokens so it themes correctly. */}
      <button
        type="button"
        onClick={props.onSeeAvailability}
        style={{
          height: 52,
          border: "none",
          borderRadius: "var(--radius-lg)",
          background: "var(--text-primary)",
          color: "var(--bg-page)",
          font: "500 1rem var(--font-ui)",
          cursor: "pointer",
        }}
      >
        {t("seeAvailability")}
      </button>

      <p className={styles.note}>{tPublic("cancellationNote")}</p>
    </div>
  );
}
