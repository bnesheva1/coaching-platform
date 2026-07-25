# Handoff: Browse / Discovery Screen — Pass 1 (mobile practitioner card + empty state)

## Overview
The seeker-facing browse/discovery screen for Прозрения (Prozreniya) — where clients find and compare wellness/spiritual practitioners. This package covers **two pieces only**, selected as the first pass out of a broader exploration: the **mobile practitioner card**, direction "2a" (bigger avatar, corner rating badge), and the **empty/no-results state**, direction "1a" (soft icon + friendly copy + CTA). Search/filter header, desktop grid, and other card directions are NOT part of this pass.

## About the Design Files
The included HTML is a **design reference**, not production code to copy directly — recreate it in the target codebase's existing environment (React Native, React web, SwiftUI, etc.) using established component patterns.

## Fidelity
**High-fidelity.** Colors, typography, spacing, radii are final via the included tokens. Recreate pixel-perfectly. States not shown (press/hover, loading, focus-visible) should follow the codebase's existing conventions.

## Piece 1 — Mobile practitioner card (direction 2a)
Card, one per practitioner, stacked vertically with `gap: 10px` between cards, each full-width within the screen's content padding.
- **Container**: `border-radius: var(--radius-lg)` (14px), `background: var(--bg-surface)`, `border: 1px solid var(--border-subtle)`, `padding: 13px`, `position: relative` (for the rating badge), flex row `gap: 13px`.
- **Avatar**: `72×72px` circle, `background: var(--accent)`, centered initial letter (fallback when no photo — swap for a real photo `object-fit: cover` when available), `font: 700 26px` display font, `color: var(--text-on-accent)`.
- **Info column**: `flex: 1; min-width: 0`, flex column `gap: 5px`, `padding-right: 52px` to keep text clear of the absolutely-positioned rating badge.
  - Name: `font: 700 15px` UI font, `color: var(--text-primary)`, single line, `white-space: nowrap; overflow: hidden; text-overflow: ellipsis` (truncates long names instead of colliding with the badge).
  - Modality/role label: `var(--text-caption)` (400 12px), `color: var(--text-tertiary)`.
  - Topic/issue tag row: flex-wrap `gap: 5px`; each tag is a pill (`border-radius: var(--radius-pill)`, `background: var(--accent-subtle)`, `color: var(--accent-subtle-text)`, `font: 600 10.5px`, `padding: 3px 8px`).
  - Bio snippet: `font: 12px` UI, `color: var(--text-secondary)`, clamped to 2 lines (`-webkit-line-clamp: 2; overflow: hidden`).
- **Rating badge**: `position: absolute; top: 11px; right: 11px`, solid pill (`background: var(--accent)`, `color: var(--text-on-accent)`, `padding: 3px 8px`, `border-radius: var(--radius-pill)`, `font: 700 11px`), shows `★ {rating}` only (no review count — count is dropped in this direction, available on tap-through to the profile).

### Interaction
Tapping the card navigates to the practitioner's profile (`Practitioner Profile.dc.html` direction — already built). No inline interaction on the card itself besides the tap target (whole card is tappable, min 44px touch height easily met by the card's ~110px height).

## Piece 2 — Empty / no-results state (direction 1a)
Shown when a search or filter combination returns zero practitioners. Never a blank screen.
- **Container**: centered column, `text-align: center`, `gap: 10px`, generous padding (`36px 24px` in the mobile reference — scale up for desktop/wider viewports, kept centered within the results area).
- **Icon**: `56×56px` circle, `background: var(--accent-glow)`, centered "✧" glyph, `font: 400 26px` display font, `color: var(--accent-subtle-text)` — a soft, non-alarming visual (not an error icon).
- **Headline**: `font: 700 15px` display font, `color: var(--text-primary)` — echoes back the query, e.g. „Нищо не открихме за „{query}““ (Nothing found for "{query}"). Interpolate the actual search term/filter combination.
- **Body copy**: `var(--text-body-sm)`, `color: var(--text-secondary)` — a warm nudge, not a dead end: suggests broadening the search or browsing everyone, and reassures that new practitioners join regularly.
- **CTA**: solid button, `background: var(--accent)`, `color: var(--text-on-accent)`, `font: 600 13px`, `padding: 10px 18px`, `border-radius: var(--radius-md)` — label "Разгледайте всички практици" (Browse all practitioners); clears all filters/search and shows the full roster.

### Behavior
- Triggered whenever the filtered/searched result set is empty (distinct from the "few results at launch" state, which still shows real cards — this state is specifically zero matches).
- The CTA's action: reset search query + all active filter/topic chips, return to the unfiltered full practitioner list.
- Copy should dynamically reflect whatever the seeker searched/filtered by, not always show the literal example text.

## Design Tokens
Full token files included in `tokens/`. Values used here (light theme):
- `--bg-surface`: card background — oklch(100% 0 0)
- `--border-subtle`: card border — oklch(91% 0.006 90)
- `--text-primary` / `--text-secondary` / `--text-tertiary`: oklch(20%/38%/56% ... 90)
- `--accent`: oklch(55% 0.15 85) — avatar bg, rating badge, CTA button
- `--accent-subtle` / `--accent-subtle-text`: pale gold pill bg/text for topic tags
- `--accent-glow`: soft accent tint used for the empty-state icon circle
- `--text-on-accent`: white — text on solid accent surfaces
- `--radius-lg` (14px), `--radius-pill` (999px), `--radius-md`
- Typography: UI font Manrope, display font PT Serif (see `fonts.css`); `--text-caption`, `--text-body-sm` scale tokens
- Dark-theme equivalents for every token are defined in `colors.css` under `[data-theme="dark"]` — both pieces should support both themes per the platform's existing theme system.

## Locale
All copy is Bulgarian (bg). Reference locale files included at `i18n/bg.json` / `i18n/en.json` — source real strings from the app's i18n system rather than hardcoding; add the empty-state copy pattern (with `{query}` interpolation) as a new key if not already present.

## Files
- `Browse Screen — Reference.html` — standalone reference showing both pieces, open directly in a browser.
- `tokens/` — design tokens (colors, spacing, typography, fonts).
- `i18n/bg.json`, `i18n/en.json` — reference locale files.

Source of truth lives in `Browse Directions.dc.html` in the main project (option ids `2a` and `1a`'s empty state), alongside other explored card directions (1b, 1c, 2b, 2c) and grid/search-header layouts not included in this pass.
