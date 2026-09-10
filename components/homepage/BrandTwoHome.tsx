"use client";

import { useEffect, useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Search, ArrowUpRight, Brain, MoonStar, PawPrint, Sparkles, HandHeart, Coffee, Palette, Target } from "lucide-react";
import Image from "next/image";
import { Link } from "@/i18n/navigation";
import { HOME_MODALITIES, DOMAIN_PILLS } from "@/lib/homepage-modalities";
import heroQuestions from "@/data/hero-questions.json";
import questionAskedHer from "@/design/question-asked-her.webp";
import questionAskedHim from "@/design/question-asked-him.webp";
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

// Each question marks its one accent word with *asterisks* — split it out so only
// that word carries the gradient (falls back to no accent if unmarked).
function splitAccent(s: string): { before: string; word: string; after: string } {
  const m = s.match(/^(.*?)\*([^*]+)\*(.*)$/);
  return m ? { before: m[1], word: m[2], after: m[3] } : { before: s, word: "", after: "" };
}

const ICONS = {
  brain: Brain,
  "moon-star": MoonStar,
  "paw-print": PawPrint,
  sparkles: Sparkles,
  "hand-heart": HandHeart,
  coffee: Coffee,
  palette: Palette,
  target: Target,
} as const;

// Two hero mood images (design/) — one is chosen at random on each page visit.
const HERO_IMAGES = [questionAskedHer, questionAskedHim];

export function BrandTwoHome({
  domainStates,
  modalityStates,
}: {
  // Roster-driven visibility, computed server-side (lib/specialties/availability).
  // Keyed by domain key / modality id → "active" | "coming_soon" | "hidden".
  domainStates: Record<string, "active" | "coming_soon" | "hidden">;
  modalityStates: Record<string, "active" | "coming_soon" | "hidden">;
}) {
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

  const activeIndex = questions.length ? index % questions.length : 0;

  // Random hero image per visit. Start at 0 so SSR and first client paint match
  // (no hydration mismatch), then pick a random one on mount.
  const [heroImageIndex, setHeroImageIndex] = useState(0);
  useEffect(() => {
    setHeroImageIndex(Math.floor(Math.random() * HERO_IMAGES.length));
  }, []);

  return (
    <section className={styles.section}>
      {/* Grey band: copy + search, full-bleed, from under the site header down to
          the "Попитай специалист" section (which sits on the page background). */}
      <div className={styles.heroBand}>
        <div className={styles.container}>
          {/* Hero row — left column (copy + search) beside the image, which stretches
              to their full combined height, reaching down to the discover section. */}
          <div className={styles.heroRow}>
            <div className={styles.leftCol}>
            <div className={styles.copyCol}>
              <p className={styles.eyebrow}>{t("brandTwoEyebrow")}</p>
              {/* Rotating questions — all rendered stacked in ONE grid cell so the
                  block is sized to the TALLEST question and the copy below never
                  shifts as they rotate (desktop). Only the active line is visible; its
                  *asterisk*-marked word (data/hero-questions.json) carries the
                  gradient. The fixed line beneath is the real <h1> — a rotating
                  heading would make an unstable, poor page title. */}
              <div className={styles.questionStack}>
                {questions.map((q, i) => {
                  const parts = splitAccent(q);
                  const active = i === activeIndex;
                  return (
                    <p
                      key={i}
                      className={`${styles.headline} ${styles.qLine} ${active ? styles.qActive : ""}`}
                      aria-hidden={!active}
                    >
                      {parts.before}
                      {parts.word && <span className={styles.gradWord}>{parts.word}</span>}
                      {parts.after}
                    </p>
                  );
                })}
              </div>
              <h1 className={styles.subcopy}>{t("brandTwoSubcopy")}</h1>
            </div>
            {/* Search sits under the copy — both in the left column, so the image
                (right) stretches to the full height of the two. Plain GET to /browse. */}
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
            </div>
            <div className={styles.imageSlot}>
              <Image
                src={HERO_IMAGES[heroImageIndex]}
                alt=""
                fill
                priority
                sizes="(max-width: 900px) 100vw, 44vw"
                style={{ objectFit: "contain", objectPosition: "bottom" }}
              />
            </div>
          </div>
        </div>
      </div>

      {/* Row 3 — "Попитай специалист": on the page background, below the grey band. */}
      <div className={styles.discoverBand}>
        <div className={styles.container}>
        <div className={styles.discover}>
          <h2 className={styles.discoverHeading}>{t("brandTwoAskSpecialist")}</h2>
          <div className={styles.pillsRow}>
            {/* Only active/coming_soon domains render (roster-driven). coming_soon
                is a non-clickable, clearly-labelled pill — never linked to /browse. */}
            {DOMAIN_PILLS.filter((p) => (domainStates[p.key] ?? "hidden") !== "hidden").map((p) => {
              const label = p.label[locale as "bg" | "en"] ?? p.label.bg;
              if (domainStates[p.key] === "coming_soon") {
                return (
                  <span key={p.key} className={`${styles.pill} ${styles.pillComingSoon}`} aria-disabled="true">
                    {label} · {t("brandTwoComingSoon")}
                  </span>
                );
              }
              return (
                <Link key={p.key} href={p.landingPath} className={styles.pill}>
                  {label}
                </Link>
              );
            })}
          </div>
          <div className={styles.tileGrid}>
          {HOME_MODALITIES.filter((m) => (modalityStates[m.id] ?? "hidden") !== "hidden").map((m) => {
            const Icon = ICONS[m.icon];
            const label = m.label[locale as "bg" | "en"] ?? m.label.bg;
            // coming_soon (or a curated placeholder with no landing path) → the
            // existing non-clickable "coming soon" tile treatment.
            if (modalityStates[m.id] === "coming_soon" || !m.landingPath) {
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
        </div>
      </div>
    </section>
  );
}
