// Design system slice 1: proves the gold accent passes WCAG contrast
// everywhere it's actually used as text or as a background-behind-text,
// in BOTH themes — and that it's never used as a body/description text
// color anywhere in the ported primitives (a static check, since
// contrast math alone can't tell "label" from "paragraph").
//
// Token values below are copied from app/tokens/colors.css — if that
// file changes, these must be updated to match (no CSS parsing here,
// deliberately kept simple for a one-off design QA script).
//
// Run: node scripts/verify-color-contrast.mjs

import { wcagContrast } from "culori";
import { readFileSync, globSync } from "node:fs";

const TOKENS = {
  light: {
    bgPage: "oklch(98% 0.006 90)",
    bgSurface: "oklch(100% 0 0)",
    bgInverse: "oklch(16% 0.006 90)",
    accent: "oklch(55% 0.15 85)",
    accentOnInverse: "oklch(78% 0.13 85)",
    textOnAccent: "oklch(100% 0 0)",
    accentSubtle: "oklch(93% 0.05 85)",
    accentSubtleText: "oklch(38% 0.11 85)",
  },
  dark: {
    bgPage: "oklch(14% 0.006 90)",
    bgSurface: "oklch(18% 0.006 90)",
    bgInverse: "oklch(98% 0.006 90)",
    accent: "oklch(78% 0.13 85)",
    accentOnInverse: "oklch(55% 0.15 85)",
    textOnAccent: "oklch(18% 0.02 85)",
    accentSubtle: "oklch(28% 0.05 85)",
    accentSubtleText: "oklch(82% 0.10 85)",
  },
};

// WCAG 2.1 AA: 1.4.3 (normal text) = 4.5:1; 1.4.11 (non-text UI
// components / large text) = 3:1. Every pairing checked here is real
// text (button labels, chip labels, the card eyebrow), so 4.5:1 is the
// applicable bar throughout — not the looser 3:1 UI-component minimum.
const NORMAL_TEXT_MIN = 4.5;

let failures = 0;
function check(label, ratio, min) {
  const pass = ratio >= min;
  console.log(`${pass ? "PASS" : "FAIL"} — ${label}: ${ratio.toFixed(2)}:1 (needs >= ${min}:1)`);
  if (!pass) failures++;
}

for (const theme of ["light", "dark"]) {
  const t = TOKENS[theme];
  console.log(`\n=== ${theme} theme ===`);
  check("Button primary bg (--accent) vs --text-on-accent", wcagContrast(t.accent, t.textOnAccent), NORMAL_TEXT_MIN);
  check(
    "Chip selected bg (--accent-subtle) vs --accent-subtle-text",
    wcagContrast(t.accentSubtle, t.accentSubtleText),
    NORMAL_TEXT_MIN,
  );
  check("Card eyebrow text, tone='surface' (--accent) vs --bg-surface", wcagContrast(t.accent, t.bgSurface), NORMAL_TEXT_MIN);
  check("Card eyebrow text, tone='surface' (--accent) vs --bg-page", wcagContrast(t.accent, t.bgPage), NORMAL_TEXT_MIN);
  // tone="inverse" uses --accent-on-inverse (the OTHER theme's --accent
  // value), not this theme's own --accent — an inverse surface is
  // effectively an island of the opposite theme, so it needs that
  // theme's gold to stay readable. Plain --accent here was the original
  // bug (1.90:1 in dark theme) — see Card.tsx and colors.css.
  check(
    "Card eyebrow text, tone='inverse' (--accent-on-inverse) vs --bg-inverse",
    wcagContrast(t.accentOnInverse, t.bgInverse),
    NORMAL_TEXT_MIN,
  );
}

console.log(
  "\n=== Static check: --accent/--accent-on-inverse are only ever used as text color on the Card eyebrow label (never body/description text) ===",
);
const files = globSync("components/ui/*.tsx");
// Matches a `color:` line referencing var(--accent) or
// var(--accent-on-inverse) anywhere on it (Card's eyebrow color is a
// tone-aware ternary, not a direct assignment, so both tokens can
// appear on the same line) — but not --accent-subtle or other
// unrelated --accent-* tokens, via the immediate closing paren.
const colorAccentPattern = /color:.*var\(--accent(-on-inverse)?\)/;
const accentAsTextColor = [];
for (const file of files) {
  const content = readFileSync(file, "utf8");
  const lines = content.split("\n");
  lines.forEach((line, i) => {
    if (colorAccentPattern.test(line)) {
      accentAsTextColor.push(`${file}:${i + 1}`);
    }
  });
}
console.log("Occurrences found:", accentAsTextColor);
const onlyInCard = accentAsTextColor.every((loc) => loc.includes("Card.tsx"));
check(
  "at least one occurrence exists (the Card eyebrow), and every occurrence is in Card.tsx — a hit anywhere else is a new, unreviewed usage",
  accentAsTextColor.length > 0 && onlyInCard ? 1 : 0,
  1,
);

console.log(`\n=== RESULT: ${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`} ===`);
process.exit(failures === 0 ? 0 : 1);
