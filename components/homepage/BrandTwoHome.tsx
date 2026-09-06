"use client";

import { useEffect, useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Search, ArrowUpRight, Brain, MoonStar, PawPrint } from "lucide-react";
import { Link } from "@/i18n/navigation";
import { HOME_MODALITIES } from "@/lib/homepage-modalities";
import heroQuestions from "@/data/hero-questions.json";
import styles from "./BrandTwoHome.module.css";

// Brand-two homepage hero (design handoff 1b). Only rendered when the active
// brand is "two" (see app/[locale]/page.tsx); brand one keeps its own Hero.

// The rotating hero questions are CONTENT, controlled in data/hero-questions.json:
// every domain under `active`, its questions for the current locale, flattened
// into one rotation. `reserved_drafts` there is parked copy for domains not yet
// live (with editorial notes) and is never cycled.
type HeroQuestionSet = { bg: string[]; en: string[] };
function heroQuestionsForLocale(locale: string): string[] {
  const active = heroQuestions.active as Record<string, HeroQuestionSet>;
  return Object.values(active).flatMap((set) => (locale === "en" ? set.en : set.bg));
}

const ICONS = { brain: Brain, "moon-star": MoonStar, "paw-print": PawPrint } as const;

export function BrandTwoHome() {
  const t = useTranslations("HomePage");
  const locale = useLocale();
  const questions = useMemo(() => heroQuestionsForLocale(locale), [locale]);
  const [index, setIndex] = useState(0);

  useEffect(() => {
    if (!questions.length) return;
    // Respect reduced motion: hold the first question static, no rotation.
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    const id = setInterval(() => setIndex((i) => (i + 1) % questions.length), 5000);
    return () => clearInterval(id);
  }, [questions.length]);

  const q = questions[index % Math.max(questions.length, 1)];

  return (
    <section className={styles.section}>
      <div className={styles.container}>
        {/* Row 1 — copy + image (image bound to the copy block only). */}
        <div className={styles.heroRow}>
          <div className={styles.copyCol}>
            <p className={styles.eyebrow}>{t("brandTwoEyebrow")}</p>
            <h1 className={styles.headline}>
              {/* key={index} remounts the span so the fade-in re-runs each rotation. */}
              {/* Plain-string questions (data/hero-questions.json) → the whole
                  line carries the gradient (no per-word split in the data). */}
              <span key={index} className={styles.question}>
                <span className={styles.gradWord}>{q}</span>
              </span>
            </h1>
            <p className={styles.subcopy}>{t("brandTwoSubcopy")}</p>
          </div>
          <div className={styles.imageSlot} aria-hidden="true" />
        </div>

        {/* Row 2 — search on its own row, under the copy column. Plain GET to
            /browse (people + professions only), same as brand one's hero. */}
        <form className={styles.searchRow} action="/browse" method="get" role="search">
          <div className={styles.searchField}>
            <Search size={20} strokeWidth={1.8} className={styles.searchIcon} aria-hidden="true" />
            <input
              className={styles.searchInput}
              type="search"
              name="q"
              placeholder={t("brandTwoSearchPlaceholder")}
              aria-label={t("brandTwoSearchPlaceholder")}
            />
          </div>
          <button className={styles.searchButton} type="submit">
            {t("brandTwoSearchButton")}
          </button>
        </form>

        {/* Row 3 — specialty tiles from the modality config. */}
        <div className={styles.tileGrid}>
          {HOME_MODALITIES.map((m) => {
            const Icon = ICONS[m.icon];
            const label = m.label[locale as "bg" | "en"] ?? m.label.bg;
            if (m.comingSoon || !m.landingPath) {
              return (
                <div key={m.id} className={`${styles.tile} ${styles.tileComingSoon}`} aria-disabled="true">
                  <Icon size={64} strokeWidth={1.6} className={styles.tileIcon} aria-hidden="true" />
                  <div style={{ marginTop: "auto" }}>
                    <div className={styles.tileLabel}>{label}</div>
                    <div className={styles.tileMeta}>{t("brandTwoComingSoon")}</div>
                  </div>
                </div>
              );
            }
            return (
              <Link key={m.id} href={m.landingPath} className={styles.tile}>
                <Icon size={64} strokeWidth={1.6} className={styles.tileIcon} aria-hidden="true" />
                <span className={styles.tileLabelRow}>
                  <span className={styles.tileLabel}>{label}</span>
                  <ArrowUpRight size={18} strokeWidth={1.8} className={styles.tileArrow} aria-hidden="true" />
                </span>
              </Link>
            );
          })}
        </div>
      </div>
    </section>
  );
}
