"use client";

import { useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Search, ArrowUpRight, Brain, MoonStar, PawPrint } from "lucide-react";
import { Link } from "@/i18n/navigation";
import { HOME_MODALITIES } from "@/lib/homepage-modalities";
import styles from "./BrandTwoHome.module.css";

// Brand-two homepage hero (design handoff 1b). Only rendered when the active
// brand is "two" (see app/[locale]/page.tsx); brand one keeps its own Hero.

type Question = { before: string; word: string; after: string };

// Rotating hero questions — one word per line carries the gradient (never the
// whole line). Brand-specific editorial copy; kept here (structured before/word/
// after) rather than flat i18n keys. bg is the live locale; en mirrors the
// handoff for a future bilingual brand.
const QUESTIONS: Record<string, Question[]> = {
  bg: [
    { before: "Мога ли да го ", word: "уволня", after: "?" },
    { before: "Струва ли си този ", word: "имот", after: "?" },
    { before: "Как да си върна ", word: "съня", after: "?" },
    { before: "Какво ме чака тази ", word: "година", after: "?" },
  ],
  en: [
    { before: "Can I ", word: "fire", after: " him?" },
    { before: "Is this property ", word: "worth", after: " it?" },
    { before: "How do I get my ", word: "sleep", after: " back?" },
    { before: "What does this ", word: "year", after: " hold for me?" },
  ],
};

const ICONS = { brain: Brain, "moon-star": MoonStar, "paw-print": PawPrint } as const;

export function BrandTwoHome() {
  const t = useTranslations("HomePage");
  const locale = useLocale();
  const questions = QUESTIONS[locale] ?? QUESTIONS.bg;
  const [index, setIndex] = useState(0);

  useEffect(() => {
    // Respect reduced motion: hold the first question static, no rotation.
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    const id = setInterval(() => setIndex((i) => (i + 1) % questions.length), 5000);
    return () => clearInterval(id);
  }, [questions.length]);

  const q = questions[index];

  return (
    <section className={styles.section}>
      <div className={styles.container}>
        {/* Row 1 — copy + image (image bound to the copy block only). */}
        <div className={styles.heroRow}>
          <div className={styles.copyCol}>
            <p className={styles.eyebrow}>{t("brandTwoEyebrow")}</p>
            <h1 className={styles.headline}>
              {/* key={index} remounts the span so the fade-in re-runs each rotation. */}
              <span key={index} className={styles.question}>
                {q.before}
                <span className={styles.gradWord}>{q.word}</span>
                {q.after}
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
