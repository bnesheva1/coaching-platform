# Handoff: Прозрения (Prozreniya) Design System

## Overview
Foundational design system for Прозрения, a bilingual (BG/EN) marketplace booking spiritual/wellness practitioners (tarot, astrology, energy work, coaching) for seekers navigating life decisions. Visual direction: Resend-style restraint (deep black, generous whitespace, restrained type) warmed toward a human/wellness audience with a single gold accent — deliberately avoiding mystical-kitsch visual clichés. Structural model for the product overall is doctolib.de (search-first marketplace).

## About the Design Files
Everything here is a **design reference built in HTML** — CSS custom-property tokens plus small React component prototypes (`.jsx`) showing intended look, states, and interaction — not production code to import as-is. Recreate these in the target codebase's actual stack (React, Vue, native, etc.) using its existing component/theming conventions. If no frontend stack exists yet, React is a safe default — the prototypes are already plain React + inline styles reading CSS variables, so a direct port is straightforward.

`reference/Hero Directions.dc.html` is the original explored-and-approved hero concept (direction "1b") the whole system was extracted from — keep for context, not for implementation.

## Fidelity
**High-fidelity.** Exact color values (as `oklch()`), type scale, spacing scale, and component states are final for this stage. Copy/text throughout is placeholder — a copywriter will refine it before ship.

## Theming
Two first-class themes, both using the **same tokens** — only the values differ:
- **Light** = default (no attribute needed).
- **Dark** = add `data-theme="dark"` to `<html>` or any ancestor container; all `var(--*)` tokens flip automatically. No component code needs to branch on theme — components only ever reference the semantic variable names.

Gold accent hue is intentionally different in strength per theme (darker/saturated gold `oklch(55% .15 85)` on light backgrounds with white text; lighter gold `oklch(78% .13 85)` on dark backgrounds with near-black text) — this keeps contrast passing (~4.5:1+) for the accent-on-fill case in both modes. **Gold is accent-only — never use it for body text color in either theme.**

## Design Tokens
All in `tokens/`, imported by `styles.css` (the single entry point to link).

**Colors** (`tokens/colors.css`) — semantic custom properties, redefined under `[data-theme="dark"]`:
- Surfaces: `--bg-page`, `--bg-surface`, `--bg-surface-2`, `--bg-sunken`, `--bg-inverse`
- Text: `--text-primary`, `--text-secondary`, `--text-tertiary`, `--text-on-accent`, `--text-on-inverse`
- Borders: `--border-subtle`, `--border-default`, `--border-strong`
- Accent (gold): `--accent`, `--accent-hover`, `--accent-active`, `--accent-subtle`, `--accent-subtle-text`, `--accent-glow`, `--focus-ring`
- Base hues (rarely used directly): `--hue-neutral: 90`, `--hue-accent: 85`

**Typography** (`tokens/typography.css`) — each a full CSS `font` shorthand:
- Display (PT Serif — headlines only): `--text-display-xl` 56px, `-lg` 40px, `-md` 32px, `-sm` 26px
- Headings: `--text-heading-lg` 22px/700 **(PT Serif — serif headline treatment)**, `--text-heading-md` 18px/700 (Manrope), `--text-heading-sm` 15px/600 (Manrope)
- Body (Manrope): `--text-body-lg` 17px, `--text-body-md` 15px, `--text-body-sm` 13.5px
- Utility: `--text-label` 13px/600, `--text-caption` 12px, `--text-overline` 12px/700 (+`--letter-overline: .06em`, uppercase), `--text-mono-sm` 12.5px

**Fonts** (`tokens/fonts.css`): `--font-display` = PT Serif, `--font-ui` = Manrope, `--font-mono` = JetBrains Mono. Loaded via Google Fonts `@import` in that file — swap for self-hosted `@font-face` if the codebase requires it (no licensing constraint either way; both are open-source/Google Fonts).

**Spacing / radii / shadow / motion** (`tokens/spacing.css`):
- Spacing: `--space-1` (4px) through `--space-24` (96px), all multiples of 4px
- Radii: `--radius-sm` 6px, `--radius-md` 10px, `--radius-lg` 14px, `--radius-xl` 20px, `--radius-pill` 999px
- Shadows: `--shadow-sm`, `--shadow-md`, `--shadow-lg` (soft, low-opacity — used sparingly, only on the search bar and elevated cards)
- Motion: `--duration-fast` 120ms, `--duration-base` 200ms, `--ease-standard` cubic-bezier(.4,0,.2,1) — no bounce/spring anywhere in this system

## Components
Each is a small, self-contained React component (`components/<group>/<Name>.jsx`) styled entirely with inline styles reading the tokens above — port the same states/props into the target stack's own component primitives (or use as a starting implementation if the stack is plain React).

- **Button** (`components/core/Button.jsx`) — props: `variant` (`primary` solid gold / `secondary` outlined / `ghost` borderless), `size` (`sm`/`md`/`lg`), `disabled`. Hover darkens (light theme, `--accent-hover`) / lightens (dark theme) by one token step; disabled = 50% opacity, no pointer events.
- **Input** (`components/core/Input.jsx`) — props: `placeholder`, `value`, `onChange`, `helperText`, `search` (bool — pill shape, embedded 44×44px gold circular go-button, used for the hero search), `onSearch`. Focus state = gold border + `0 0 0 4px var(--focus-ring)`, never a default browser outline.
- **Card** (`components/core/Card.jsx`) — props: `eyebrow` (gold overline label), `title` (serif heading), `description`, `footer` (ReactNode, typically a Button), `tone` (`surface` default / `inverse` flips to `--bg-inverse` for a dark block on a light page or vice versa).
- **Chip** (`components/core/Chip.jsx`) — props: `children`, `selected` (bool — gold-tinted background/border/text when true), `onClick`. Pill radius, used for hero topic filters.
- **NavBar** (`components/navigation/NavBar.jsx`) — props: `lang` (`BG`/`EN`), `links` (string array). Composes Button (`ghost` for Вход, `primary` for Регистрация); language toggle is a plain bordered pill, not a Button variant.

Each component folder also has a matching `<Name>.d.ts` (props contract) and `<Name>.prompt.md` (usage example + notes) — read these alongside the `.jsx` for exact prop semantics.

## Interactions & Behavior
- **Hero rotating questions** (see `reference/Hero Directions.dc.html`, direction 1b): cross-fade cycle through a fixed list of real client questions (~15s per full cycle, ~3s visible per question, opacity fade in/out). Must:
  - Respect `prefers-reduced-motion: reduce` — show only the first question, statically, no animation.
  - Stay screen-reader accessible — the rotating lines are `aria-hidden`; a single visually-hidden (`.sr-only`) `<h1>` holds the real heading text for assistive tech, not the animated marquee.
- **Focus states**: always a visible gold ring, never suppressed — required for keyboard navigation across all interactive components.
- **Chip/filter selection**: toggling `selected` should read as a lightweight local UI state (topic chips filtering search), not full page navigation.

## Assets
No logo or icon assets were supplied. The wordmark is set in plain type (PT Serif 700, "Прозрения") everywhere a mark would go — see `guidelines/wordmark.card.html`. The only glyph currently in use anywhere in the system is a plain Unicode arrow (→) on the search button; no custom icon set exists yet. Request real logo/icon assets before final implementation, or substitute a neutral thin-stroke icon library (e.g. Lucide) and flag the substitution.

## Screenshots
`screenshots/` — rendered captures of the specimen pages and the original hero exploration, for quick visual reference alongside the live HTML:
- `colors-light.png` / `colors-dark.png` — surface + accent swatches, both themes
- `type-display.png` — PT Serif display scale
- `type-ui.png` — Manrope UI/body scale + serif heading-lg
- `spacing.png` — 4px spacing scale
- `radii-shadow.png` — corner radii + shadow tokens
- `wordmark.png` — wordmark in both themes
- `hero-directions.png` — the 3 explored hero directions (1b was approved into this system)

Component demo cards (`components/*/*.card.html`) aren't screenshotted — they depend on a platform-generated bundle file not present outside the design tool; open the `.jsx` files directly instead.

## Files
```
styles.css                      — entry point, @imports every token file below
tokens/
  fonts.css                     — @font-face/import + --font-* family variables
  colors.css                    — light + [data-theme="dark"] semantic color tokens
  typography.css                — type scale (font shorthands)
  spacing.css                   — spacing, radii, shadow, motion tokens
components/
  core/Button.jsx (+.d.ts, .prompt.md)
  core/Input.jsx  (+.d.ts, .prompt.md)
  core/Card.jsx   (+.d.ts, .prompt.md)
  core/Chip.jsx   (+.d.ts, .prompt.md)
  core/core.card.html           — live demo of the 4 core components together
  navigation/NavBar.jsx (+.d.ts, .prompt.md)
  navigation/navigation.card.html
guidelines/                     — visual specimen pages (colors, type, spacing, radii, wordmark) — open any in a browser to see live token values rendered
reference/Hero Directions.dc.html — original hero exploration (3 directions); direction 1b was approved and became this system
```
