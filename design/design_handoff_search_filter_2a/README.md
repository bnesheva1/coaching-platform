# Handoff: Browse/Discovery Search &amp; Filter — Direction 2a ("Sidebar filters")

## Overview
Search and filter controls for the seeker-facing browse/discovery screen on Прозрения (Prozreniya), sitting above/beside a responsive grid of practitioner cards. This package covers **only direction 2a** — the e-commerce-style left sidebar filter pattern (Amazon-style grouped checkboxes with result counts), one of several explored directions.

## About the Design Files
The included HTML is a **design reference**, not production code — recreate it in the target codebase's existing environment (React, etc.) using established component patterns and state management.

## Fidelity
**High-fidelity.** Colors, typography, spacing, radii are final via the included tokens. Recreate pixel-perfectly. Unshown states (hover, loading, focus-visible) follow the codebase's existing conventions.

## Concept
On desktop, a fixed-width left sidebar (`170px`) holds two grouped checkbox filters — "Практика" (Modality) and "Тема / въпрос" (Topic/issue) — each option showing a live result count in parentheses. The results grid sits to the right, full remaining width. On mobile, the sidebar collapses into a "Филтри" (Filters) button with a count badge; tapping it opens a bottom sheet containing the same grouped-checkbox content, plus a sticky "Show N results" submit button.

Regardless of desktop/mobile, **active filters remain visible above the results grid at all times** as removable chips, alongside a live result count and a "Изчистете" (Clear) action — so a sparse result set is never unexplained, even with the sidebar/sheet closed.

## Screens / Views

### Desktop — sidebar + grid
- **Outer layout**: flex row, `gap: 18px`, sidebar `width: 170px; flex: none`, results area `flex: 1; min-width: 0`.
- **Sidebar header**: flex row `space-between` — "Филтри" label (`font: 700 13px` UI, `color: var(--text-primary)`) and "Изчистете" (Clear) link (`font: 600 11px`, `color: var(--accent)`, underline).
- **Filter group** (×2 — Практика, Тема/въпрос): group label `var(--text-label)`, `color: var(--text-secondary)`, `margin-bottom: 8px`; options stacked `gap: 7px`.
  - **Checkbox row**: native `<input type="checkbox">` (`accent-color: var(--accent)`, `14×14px`) + label text `font: 12.5px` UI. Checked/active option text is `var(--text-primary)`; unchecked is `var(--text-secondary)`.
  - **Count**: `(N)` in `color: var(--text-tertiary)`, appended after the label text.
  - **Zero-count option**: checkbox gets `disabled`, label text drops to `var(--text-tertiary)`, count still shows as `(0)` — **do not remove the row**; seekers should still see the full taxonomy even when an option currently has no matches.
- **Divider**: `1px` solid `var(--border-subtle)` between the two filter groups.
- **Results area, top to bottom**:
  1. Search box: `background: var(--bg-surface)`, `border: 1px solid var(--border-default)`, `border-radius: var(--radius-lg)`, `padding: 10px 13px`, placeholder-style text `font: 12.5px`, `color: var(--text-tertiary)` reading "Търсете по име, практика или вашия въпрос" (Search by name, modality, or your issue).
  2. Active-filters row: flex, `gap: 6px`, wraps. Each active filter is a removable chip (`background: var(--accent-subtle)`, `color: var(--accent-subtle-text)`, pill radius, `✕` at ~70% opacity). Followed by a live result-count string, e.g. "1 практик намерен" (1 practitioner found), `font: 11px`, `color: var(--text-tertiary)`.
  3. Results grid: responsive grid (2–3 columns desktop depending on breakpoint, shown here 2-col at 640px reference width; production should flex to viewport), `gap: 10px` — uses the already-chosen practitioner card component (see "Dependencies" below).

### Mobile — collapsed
- Search box: same styling as desktop, full width.
- Control row below search: flex, `gap: 8px`. Left: "⚙ Филтри" button (pill, `background: var(--bg-surface)`, `border: 1px solid var(--border-default)`, `padding: 8px 13px`, `font: 600 12.5px`) with a circular count badge (`14×14px`... actually `17×17px`, `background: var(--accent)`, `color: var(--text-on-accent)`, `font: 700 10px`) showing the number of active filters. Right: active-filter chips in a horizontally scrolling row (`overflow-x: auto`), same chip styling as desktop.
- Divider, then the results list (practitioner cards stacked, full width — see the separately-handed-off card component).

### Mobile — filter sheet expanded
- Standard bottom sheet: scrim behind (`background: rgba(20,17,10,.4)`), sheet panel `border-radius: 18px 18px 0 0`, `background: var(--bg-surface)`, `padding: 16px`, drag handle (`36×4px`, `border-radius: 2px`, `background: var(--border-default)`, centered).
- Sheet header: "Филтри" title (`font: 700 15px` display font) + "Изчистете" (Clear) link, `space-between`.
- Same grouped-checkbox content as the desktop sidebar (scrollable if it exceeds sheet height — cap sheet height at ~80vh with internal scroll for the filter list, per platform convention).
- **Sticky submit button** at the bottom of the sheet: `background: var(--accent)`, `color: var(--text-on-accent)`, `border-radius: var(--radius-md)`, `padding: 12px`, `font: 600 13.5px`, label dynamically reflects the live count, e.g. "Покажи 1 резултат" (Show 1 result) — updates as checkboxes are toggled, before the sheet closes.

## Interactions & Behavior
- **Checkbox toggle**: multi-select within each group (checking "Таро" + "Астрология" = OR within modality); groups combine with AND (modality AND topic). Confirm exact combine logic with product if unspecified.
- **Live counts**: each option's `(N)` reflects how many practitioners would match if that option were added to the *current* filter state (not a static global count) — recompute on every filter change.
- **Zero-count degradation**: options with `(0)` matches stay visible but disabled/greyed rather than hidden — keeps the taxonomy legible even with the small launch roster (~3–5 practitioners). Revisit whether to hide `(0)` options once the roster is large enough that zero-count clutter becomes the more common case.
- **Active-filter chips** (shown above the results grid, both platforms): tapping the `✕` on a chip removes that one filter; state and the sidebar/sheet checkboxes update to match.
- **Clear (Изчистете)**: resets all active filters and the search query; present both in the sidebar/sheet header and inline near the active-filter chips.
- **Mobile sheet**: opens on tapping the "Филтри" button; traps focus while open; closes on submit-button tap, scrim tap, or Esc, returning focus to the "Филтри" button. Filter changes apply live behind the sheet is optional — recommended default: apply on submit-button tap (so the count in the sticky button is a preview, not yet committed) to avoid the results grid re-flowing while the sheet is still open.
- **Search box**: filters by name, modality, or free-text matching a seeker's described issue — combine with any active checkbox filters (AND).
- **Result count string**: always visible near the top of the results area (not just inside the sheet), so a sparse or zero result set is explained even when the filter controls are fully collapsed.

## State Management
Suggested shape (adapt to codebase patterns):
- `searchQuery: string`
- `selectedModalities: Set<string>`
- `selectedTopics: Set<string>`
- `optionCounts: { modality: Record<string, number>, topic: Record<string, number> }` — recomputed from current result set for live counts.
- `results: Practitioner[]` — filtered list driving the grid.
- `isFilterSheetOpen: boolean` (mobile only).
- Data fetching: option counts and filtered results should come from the real practitioner directory/search backend, not computed client-side once the roster grows.

## Design Tokens
Full token files in `tokens/`. Values used here (light theme):
- `--bg-surface`: oklch(100% 0 0) — cards, search box, sheet panel
- `--bg-page`: oklch(98% 0.006 90) — page background
- `--border-subtle` / `--border-default`: oklch(91%/85% 0.006-0.008 90)
- `--text-primary` / `--text-secondary` / `--text-tertiary`: oklch(20%/38%/56% ... 90)
- `--accent`: oklch(55% 0.15 85) — checked checkbox accent, active chip removed color, submit button, count badge
- `--accent-subtle` / `--accent-subtle-text`: pale gold pill bg/text for active-filter chips
- `--text-on-accent`: white
- `--radius-lg` (14px), `--radius-md`, `--radius-pill` (999px)
- Typography: `--text-label` (group headers), UI font Manrope, display font PT Serif (sheet title only)
- Dark-theme equivalents defined in `colors.css` under `[data-theme="dark"]` — support both themes per the platform's theme system.

## Dependencies
This package assumes the practitioner card component (direction "2a" card — bigger avatar + corner rating badge) and the empty/no-results state (direction "1a") are already implemented — see the separately delivered `design_handoff_browse_pass1` package for their full spec. This filter UI slots directly above/beside that grid; when the filtered result set is empty, show that empty state instead of the grid.

## Locale
All copy is Bulgarian (bg). Reference locale files at `i18n/bg.json` / `i18n/en.json` — source real strings (including the dynamic "N практика/практици намерен/и" pluralization and the sheet's "Покажи N резултат/а" button label) from the app's i18n system.

## Files
- `Search Filter 2a — Reference.html` — standalone reference (desktop sidebar+grid, mobile collapsed, mobile sheet expanded).
- `tokens/` — design tokens.
- `i18n/bg.json`, `i18n/en.json` — reference locale files.

Source of truth lives in `Search Filter Directions.dc.html` in the main project (option id `2a`), alongside other explored directions (turn 1: sheet/accordion/chips-first patterns; turn 2: `2b` horizontal dropdown-pill bar) not included in this handoff.
