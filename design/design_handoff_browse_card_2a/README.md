# Handoff: Browse/Discovery Page — Practitioner Card Direction 2a ("Centered, premium")

## Overview
The seeker-facing browse/discovery page for Прозрения (Prozreniya) — search, sidebar filters, sort, and a grid of practitioner cards. This package covers the **selected final direction**: card style 2a (centered composition — large circular photo, everything stacked and centered, soft shadow card) plus the surrounding page chrome (search bar with icon, sort control, subtle sidebar filter panel).

## About the Design Files
The included HTML is a **design reference**, not production code — recreate it in the target codebase's existing environment (React, etc.) using established component patterns and state management.

## Fidelity
**High-fidelity.** Colors, typography, spacing, radii are final via the included tokens. Recreate pixel-perfectly. Unshown states (hover, loading, focus-visible, disabled) follow the codebase's existing conventions.

## Design intent
This replaces an earlier, more utilitarian card treatment. The goals driving every decision below: generous whitespace, the photo as the true focal point (not a small functional avatar), soft/no-border card treatment, calm secondary info, and a quiet booking action — a premium consumer marketplace feel, not admin tooling.

## Practitioner card (2a)
- **Container**: `border-radius: 24px`, `background: var(--bg-surface)`, no border — soft two-layer shadow instead (`0 2px 6px rgba(30,22,8,.05), 0 20px 40px -12px rgba(30,22,8,.12)`), `padding: 28px 22px 22px`, flex column, `align-items: center`, `text-align: center`, `gap: 11px`, `position: relative` (for the rating badge).
- **Rating badge**: absolutely positioned at the card's `top: 16px; right: 16px` (not on the avatar) — solid pill, `background: var(--accent)`, `color: var(--text-on-accent)`, `padding: 3px 8px`, `font: 700 10.5px`. Omitted entirely when a practitioner has no rating yet (new practitioners) — do not show a placeholder/zero.
- **Avatar/photo**: `138×138px` circle, centered.
  - **Photo present** (the norm — most practitioners upload a photo, symbol, or logo): the image fills the circle (`object-fit: cover`), plus a soft shadow (`0 4px 14px rgba(30,22,8,.14)`) for lift — no border.
  - **Fallback (no photo)** — recessive, quiet treatment: soft gradient fill `linear-gradient(160deg, var(--bg-sunken), var(--bg-surface-2))`, centered initial letter at `600 45px` display font, `color: var(--accent-subtle-text)`, `opacity: .7`. Deliberately muted relative to the photo case, since photo is the norm.
- **Name**: `font: 700 16px` display font (PT Serif), `color: var(--text-primary)`, `margin-top: 4px` from avatar.
- **Modality**: directly below name, `font: 11.5px` UI, `color: var(--text-tertiary)`, `letter-spacing: .02em`.
- **Topic/issue chips**: centered, wrapping row, `gap: 6px`. Each chip: pill, `background: var(--accent-subtle)`, `color: var(--accent-subtle-text)`, `font: 600 10.5px`, `padding: 3px 8px`.
- **Bio snippet**: centered, `font: 12.5px/1.55`, `color: var(--text-secondary)`, clamped to 2 lines (`-webkit-line-clamp: 2`).
- **Book action ("Запази час")**: quiet text link (not a filled button) — `font: 600 12.5px`, `color: var(--accent)`, sits at the bottom of the card (`margin-top: auto` pushes it down when card heights vary in a grid row).

## Page chrome
- **Page title**: "Открий специалист" (Find a specialist), `font: 400 26px` display font, `color: var(--text-primary)`.
- **Search bar**: `background: var(--bg-surface)`, `border: 1px solid var(--border-default)`, `border-radius: var(--radius-lg)`, `padding: 13px 16px`, subtle shadow (`0 1px 2px rgba(0,0,0,.03)`). Contains a Lucide-style search icon (inline SVG — 16×16, `stroke="currentColor"`, `stroke-width="2"`, circle + diagonal line, see reference file's `<svg>` markup) followed by the helper/placeholder text "Търсете по име, практика или вашия въпрос" (Search by name, modality, or your issue). **No icon library was wired into this project yet** — this SVG is a direct substitute matching Lucide's `search` icon; if the codebase already has Lucide (or another icon set) installed, use its actual `Search` component instead of this inline SVG.
- **Sidebar filter panel**: bounded card (not bare checkboxes in empty space) — `width: 190px`, `background: var(--bg-surface-2)`, `border-radius: var(--radius-xl)`, `padding: 18px`, subtle shadow. Header row: "Филтри" (Filters) label + "Изчисти" (Clear) link, `space-between`. Below: a "Практика" (Modality) checkbox group, each option showing a live result count in parentheses, e.g. "Таро (6)".
- **Results header row**: `space-between` flex row above the grid — left: live result count ("16 практици намерени" / 16 practitioners found); right: a "Подредба" (Sort by) `<select>` — `background: var(--bg-surface)`, `border: 1px solid var(--border-default)`, `border-radius: var(--radius-md)`, `padding: 6px 10px`, `font: 600 12px`. Options: **Рейтинг (Rating) — default**, Име (А-Я) (Name A-Z), Най-нови (Newest).
- **Results grid**: `display: grid`, `grid-template-columns: repeat(3, 1fr)` on desktop (adjust column count at narrower breakpoints per the codebase's responsive conventions — 2-col tablet, 1-col mobile), `gap: 18px`.

## Interactions & Behavior
- **Sort control**: changes the order of the results grid. Default is by rating (highest first). Re-sort should not refetch/lose active filters.
- **Filter checkboxes**: multi-select within the "Практика" group (OR); combine with any other filter groups via AND. Each option's count reflects current-filter-state result count, recomputed live.
- **Card tap**: whole card is tappable, navigates to the practitioner's profile; "Запази час" link inside can either navigate to the same profile (its booking section) or open a quick-book flow — confirm with product which.
- **Zero-rating practitioners**: badge is omitted, not replaced with a placeholder — don't imply an untrustworthy "0" score for practitioners who are simply new.
- **No-photo fallback**: not interactive beyond the normal card tap; visually recessive by design (see fallback treatment above) so it doesn't compete with photo cards in the same grid row.

## State Management
Suggested shape (adapt to codebase patterns):
- `searchQuery: string`
- `selectedModalities: Set<string>`
- `sortBy: 'rating' | 'name' | 'newest'` (default `'rating'`)
- `practitioners: Array<{ id, name, modality, rating: number|null, bio, photoUrl: string|null, chips: string[] }>`
- Data fetching: practitioner list, filter counts, and sort should be driven by the real directory/search backend.

## Design Tokens
Full token files in `tokens/`. Values used here (light theme):
- `--bg-surface`: oklch(100% 0 0) — card, search bar, sort select
- `--bg-surface-2`: oklch(95.5% 0.01 90) — sidebar panel fill
- `--bg-sunken`: fallback avatar gradient start
- `--border-default`: search bar / select border
- `--text-primary` / `--text-secondary` / `--text-tertiary`
- `--accent`: oklch(55% 0.15 85) — rating badge, book action text, checkbox accent
- `--accent-subtle` / `--accent-subtle-text`: topic chip bg/text, fallback-avatar initial color
- `--text-on-accent`: white — rating badge text
- `--radius-xl` (sidebar panel, ~20px), `--radius-lg`, `--radius-md`, `--radius-pill`
- Typography: display font PT Serif (card name, page title), UI font Manrope (everything else)
- Dark-theme equivalents defined in `colors.css` under `[data-theme="dark"]` — support both themes per the platform's theme system. Note: the card's tone gradients (avatar-photo placeholders in this reference file) are illustrative stand-ins for real uploaded photos — they are not part of the design system and should not be ported; use real `<img>`/`object-fit: cover` in production.

## Locale
All copy is Bulgarian (bg). Reference locale files at `i18n/bg.json` / `i18n/en.json` — source real strings (search helper text, "Изчисти", "Подредба", sort option labels, "Запази час") from the app's i18n system.

## Files
- `Browse Page — Reference.html` — standalone reference: card zoom (photo + fallback) and the full page (search, sort, sidebar, 16-card grid).
- `tokens/` — design tokens.
- `i18n/bg.json`, `i18n/en.json` — reference locale files.

Source of truth lives in `Practitioner Card Refinement Directions.dc.html` (card component `Card2a.dc.html`) in the main project, alongside other explored card directions (1a/1b/1c, 2b/2c) not included in this handoff.
