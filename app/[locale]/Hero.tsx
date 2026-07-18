import { getTranslations } from "next-intl/server";
import { Input } from "@/components/ui/Input";
import { HeroTopicChips } from "./HeroTopicChips";
import styles from "./Hero.module.css";

// Server Component — the rotating headline is pure CSS (see
// Hero.module.css, ported verbatim from the approved reference file),
// and the search box is a plain GET form straight to /browse, so
// nothing here needs client-side JS. Only HeroTopicChips (the one
// interactive piece) is a Client Component, kept as narrow as possible
// so this marketing/SEO content stays server-rendered.
export async function Hero() {
  const t = await getTranslations("HomePage");
  const questions = [
    t("heroQuestion1"),
    t("heroQuestion2"),
    t("heroQuestion3"),
    t("heroQuestion4"),
    t("heroQuestion5"),
  ];
  const topics = [t("heroChipLoveRelationships"), t("heroChipBusinessFinance"), t("heroChipLifePath")];

  return (
    <div style={{ position: "relative", overflow: "hidden" }}>
      <div
        aria-hidden
        style={{
          position: "absolute",
          top: -120,
          right: -80,
          width: 420,
          height: 420,
          borderRadius: "50%",
          background: "radial-gradient(circle, var(--accent-glow), transparent 70%)",
          pointerEvents: "none",
        }}
      />
      <div
        style={{
          position: "relative",
          padding: "60px 64px 56px",
          display: "flex",
          flexDirection: "column",
          gap: "var(--space-6)",
          maxWidth: 560,
        }}
      >
        <span
          style={{
            font: "var(--text-overline)",
            letterSpacing: "var(--letter-overline)",
            textTransform: "uppercase",
            color: "var(--accent)",
          }}
        >
          {t("heroEyebrow")}
        </span>

        <div className={styles.rotator} style={{ height: 130, width: "100%" }}>
          {/* Visually hidden — holds the real heading text for assistive
              tech. The animated lines below are aria-hidden. */}
          <h1 className={styles.srOnly}>{questions[0]}</h1>
          {questions.map((question, i) => (
            <div
              key={question}
              aria-hidden="true"
              className={styles.rline}
              style={{
                animationDelay: `${i * 3}s`,
                // 34px/1.28 is a deliberate, hero-specific size from the
                // reference file — it doesn't match any display-scale
                // step (26/32/40/56px), and was used consistently across
                // all three explored hero directions, so it reads as an
                // intentional one-off for this element, not an oversight
                // to normalize onto the nearest token.
                font: "400 34px/1.28 var(--font-display)",
              }}
            >
              {question}
            </div>
          ))}
        </div>

        <p style={{ margin: 0, font: "var(--text-body-md)", color: "var(--text-secondary)" }}>{t("heroSubhead")}</p>

        <form action="/browse" method="get" style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
          <Input search name="q" placeholder={t("heroSearchPlaceholder")} helperText={t("heroSearchHelper")} />
        </form>

        <HeroTopicChips topics={topics} />
      </div>
    </div>
  );
}
