import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { ArrowRight, Check, ShieldCheck, ChevronDown } from "lucide-react";
import { Link } from "@/i18n/navigation";
import { ContentContainer } from "@/components/ui/ContentContainer";
import styles from "./kit.module.css";

// Shared component kit for the brand-two content/funnel pages (1i/1j/1k/1m),
// per design_handoff_brand_two_pages. Built once, reused across pages — icons
// and copy are passed in, the presentation lives here. All server components
// (the accordion is native <details>, no client boundary needed).

export function Eyebrow({ children, muted = false }: { children: ReactNode; muted?: boolean }) {
  return <p className={`${styles.eyebrow}${muted ? ` ${styles.eyebrowMuted}` : ""}`}>{children}</p>;
}

// Primary CTA — INK fill, white text, trailing arrow (never the teal accent;
// the handoff's single most-repeated correction was "green text doing CTA duty"
// → a real ink button).
export function InkButton({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link href={href} className={styles.inkBtn}>
      {children}
      <ArrowRight size={18} strokeWidth={1.8} aria-hidden="true" />
    </Link>
  );
}

// Hatched placeholder — no photography supplied yet; keeps the intended aspect
// ratio and a mono subject label.
export function ImageSlot({ label, aspectRatio = "4 / 3" }: { label: string; aspectRatio?: string }) {
  return (
    <div className={styles.imageSlot} style={{ aspectRatio }} aria-hidden="true">
      <span className={styles.imageSlotLabel}>image slot · {label}</span>
    </div>
  );
}

export function CheckChips({ items }: { items: string[] }) {
  return (
    <ul className={styles.chips} style={{ listStyle: "none", padding: 0, margin: 0 }}>
      {items.map((item) => (
        <li key={item} className={styles.chip}>
          <Check size={16} strokeWidth={2} aria-hidden="true" />
          {item}
        </li>
      ))}
    </ul>
  );
}

export type StepItem = { n: number; Icon: LucideIcon; title: string; body: string };

// Card-variant step row (1j, 1m): teal numeral circle top-left, outline icon
// top-right. 3-column grid; 5 items flow 3+2 (never auto-fit — it orphans the
// last row).
export function StepCards({ steps }: { steps: StepItem[] }) {
  return (
    <div className={styles.stepGrid}>
      {steps.map(({ n, Icon, title, body }) => (
        <div key={n} className={styles.stepCard}>
          <span className={styles.stepNumeral}>{n}</span>
          <Icon className={styles.stepIcon} size={40} strokeWidth={1.6} aria-hidden="true" />
          <h3 className={styles.stepTitle}>{title}</h3>
          <p className={styles.stepBody}>{body}</p>
        </div>
      ))}
    </div>
  );
}

export type FaqItem = { Icon: LucideIcon; question: string; answer: string };

// Accordion via native <details> — collapsed by default; the chevron rotates on
// [open] and the answer reveals inside the same hairline container.
export function FaqAccordion({ items }: { items: FaqItem[] }) {
  return (
    <div className={styles.qList}>
      {items.map(({ Icon, question, answer }) => (
        <details key={question} className={styles.qItem}>
          <summary className={styles.qSummary}>
            <Icon size={40} strokeWidth={1.6} aria-hidden="true" />
            {question}
            <ChevronDown className={styles.qChevron} size={18} strokeWidth={1.8} aria-hidden="true" />
          </summary>
          <p className={styles.qAnswer}>{answer}</p>
        </details>
      ))}
    </div>
  );
}

// "Какво е важно да знаете" — the legally-reviewed disclaimer, unified visual
// treatment. Sits in the right column beside the FAQ list (fills the width).
export function TrustCard({ heading, body, ticks }: { heading: string; body: string; ticks: string[] }) {
  return (
    <div className={styles.trustCard}>
      <ShieldCheck className={styles.trustIcon} size={26} strokeWidth={1.7} aria-hidden="true" />
      <h3 className={styles.trustHeading}>{heading}</h3>
      <p className={styles.trustBody}>{body}</p>
      {ticks.length > 0 && (
        <ul className={styles.trustTicks}>
          {ticks.map((tick) => (
            <li key={tick} className={styles.trustTick}>
              <Check size={16} strokeWidth={2} aria-hidden="true" />
              {tick}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// Full-bleed grey closing band (1i, 1j): eyebrow + heading + body + ink CTA
// beside an image slot. Its own inner ContentContainer keeps content aligned
// with the rest of the page while the band background spans the viewport.
export function SectionBand({
  eyebrow,
  heading,
  body,
  ctaHref,
  ctaLabel,
  imageLabel,
}: {
  eyebrow?: string;
  heading: string;
  body: string;
  ctaHref: string;
  ctaLabel: string;
  imageLabel: string;
}) {
  return (
    <section className={styles.band}>
      <ContentContainer>
        <div className={styles.bandGrid}>
          <div>
            {eyebrow ? <Eyebrow>{eyebrow}</Eyebrow> : null}
            <h2 className={styles.h2}>{heading}</h2>
            <p className={styles.body} style={{ margin: "var(--space-4) 0 var(--space-8)", maxWidth: "48ch" }}>
              {body}
            </p>
            <InkButton href={ctaHref}>{ctaLabel}</InkButton>
          </div>
          <ImageSlot label={imageLabel} aspectRatio="16 / 10" />
        </div>
      </ContentContainer>
    </section>
  );
}

export type FeatureItem = { Icon: LucideIcon; title: string; body: string };

// Benefit cards (1i): hairline card, standalone 40px accent icon, title, body.
// 3-column grid; 5 items flow 3+2.
export function FeatureCards({ items }: { items: FeatureItem[] }) {
  return (
    <div className={styles.featureGrid}>
      {items.map(({ Icon, title, body }) => (
        <div key={title} className={styles.featureCard}>
          <Icon className={styles.featureIcon} size={40} strokeWidth={1.6} aria-hidden="true" />
          <h3 className={styles.featureTitle}>{title}</h3>
          <p className={styles.featureBody}>{body}</p>
        </div>
      ))}
    </div>
  );
}

export type ConnectedStepItem = { n: number; title: string; body: string };

// Connected-circle step row (1i): centred columns, teal numeral circles on a
// continuous hairline rule (masked at the ends via CSS). No icons.
export function ConnectedSteps({ steps }: { steps: ConnectedStepItem[] }) {
  return (
    <div className={styles.connectedSteps}>
      {steps.map(({ n, title, body }) => (
        <div key={n} className={styles.connectedStep}>
          <span className={styles.connectedNumeral}>{n}</span>
          <h3 className={styles.connectedTitle}>{title}</h3>
          <p className={styles.connectedBody}>{body}</p>
        </div>
      ))}
    </div>
  );
}

// Full-bleed grey quote band (1i). Wraps the quote in Bulgarian „…“ marks.
export function QuoteBand({ quote, attribution }: { quote: string; attribution: string }) {
  return (
    <section className={styles.quoteBand}>
      <ContentContainer>
        <p className={styles.quote}>„{quote}“</p>
        <p className={styles.quoteAttribution}>{attribution}</p>
      </ContentContainer>
    </section>
  );
}
