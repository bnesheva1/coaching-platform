# Handoff: Client Booking Slot-Picker — Direction 3a ("Soft day cards, pill chips")

## Overview
The client-facing "pick a day → pick a time → confirm" booking widget for Прозрения (Prozreniya), a booking marketplace connecting clients with spiritual/wellness practitioners (tarot, astrology, reiki, etc.). This is the widget a client uses on a practitioner's profile or service page to select an available appointment slot. This package covers **only direction 3a** of three explored directions — the day-card layout with filled gold pill time chips.

## About the Design Files
The included HTML file is a **design reference created in HTML** — a prototype showing intended look, spacing, and states, not production code to copy directly. The task is to **recreate this HTML design in the target codebase's existing environment** (React, Vue, SwiftUI, native, etc.) using its established component patterns, state management, and libraries — or, if no environment exists yet, choose the most appropriate framework and implement there.

## Fidelity
**High-fidelity (hifi).** Colors, typography, spacing, and radii are final (via the included design tokens). Recreate pixel-perfectly using the codebase's existing libraries/patterns. Interaction states beyond what's shown (loading, error, focus-visible) should follow the codebase's existing conventions since they weren't explicitly designed here.

## Concept
Each day with availability renders as its own rounded card ("day card"). Inside a card: a weekday abbreviation + date, then that day's open time slots as filled pill-shaped chips. A day with no openings still renders a card, but dashed-border, sunken background, and no chips — just a "no availability" message. Selected time = solid gold pill; unselected times = pale gold ("subtle accent") pills. Desktop shows multiple day cards side by side with prev/next arrows for paging through further days; mobile stacks the same cards vertically with no horizontal scroll, plus a "show more days" link at the bottom of the scroll region.

## Screens / Views

### Desktop — day columns
- **Layout**: A single surface (card) at `640px` width (flex/responsive in production), `20px` padding, background `var(--bg-page)`.
  - Top row: flex, `space-between`, `margin-bottom: 14px`. Left: timezone disclosure text. Right: "Отиди на дата" (Jump to date) link, underlined, accent color.
  - Main row: flex, `gap: 12px`, `align-items: flex-start`. Contains: prev-arrow (‹), 2–3 day cards each `flex: 1`, next-arrow (›). Arrows are `var(--text-tertiary)`, `16px`, vertically centered via `align-self: center`.
- **Day card (available)**: `border-radius: var(--radius-xl)` (20px), `background: var(--bg-surface)`, `border: 1px solid var(--border-subtle)`, `padding: 14px`, flex column, `gap: 10px`.
  - Weekday label: `var(--text-caption)` (400 12px/1.5 Manrope), color `var(--text-tertiary)`.
  - Date label: `600 16px` UI font, color `var(--text-primary)`.
  - Time chip row: flex-wrap, `gap: 6px`.
  - Time chip (unselected): `padding: 7px 12px`, `border-radius: var(--radius-pill)` (999px), `background: var(--accent-subtle)`, `color: var(--accent-subtle-text)`, `font: 600 12px` UI.
  - Time chip (selected): same shape, `background: var(--accent)`, `color: var(--text-on-accent)`.
- **Day card (no availability)**: `background: var(--bg-sunken)`, `border: 1px dashed var(--border-default)`, content centered (`align-items: center; justify-content: center; text-align: center`), `min-height: 96px`. Weekday/date same styles but date color drops to `var(--text-tertiary)`. Below: "Няма свободни часове" (No available times), `var(--text-caption)` / tertiary.

### Mobile — vertical stack
- **Layout**: `230px`-wide reference frame (production: full viewport width), fixed height with internal scroll in the mock (`height: 420px; overflow: hidden` on outer, `flex:1; overflow-y:auto` on the day-card list) — in production this is simply the page's natural scroll, not a fixed-height scroll box.
  - Header block (non-scrolling): timezone text (`10px`) + "Отиди на дата" link (`11px`, accent, underline), `padding: 14px 14px 8px`.
  - Scrolling list: `padding: 0 14px`, flex column, `gap: 10px` between day cards.
- **Day card (available)**: `border-radius: var(--radius-lg)` (14px, one step smaller than desktop's xl), `background: var(--bg-surface)`, `border: 1px solid var(--border-subtle)`, `padding: 12px`, flex column `gap: 8px`. Day label `600 13px` UI, primary color. Chips: `padding: 6px 10px`, pill radius, `font: 600 11px`; same subtle/selected accent treatment as desktop, sized down.
- **Day card (no availability)**: `border-radius: var(--radius-lg)`, `background: var(--bg-sunken)`, `border: 1px dashed var(--border-default)`, `padding: 12px`, centered text. Day label `600 12px` tertiary; message `10px` tertiary.
- **"Show more days" affordance**: centered link, `11px`, accent color, underline, `padding: 6px 0`, at the bottom of the scrolling list — loads/reveals additional day cards (infinite-scroll or "load more" pattern; exact mechanism left to implementation).

## Interactions & Behavior
- **Tapping/clicking an unselected time chip** selects it: previous selection (if any) reverts to the subtle/unselected pill style, the newly tapped chip becomes the solid accent pill. Only one time may be selected at a time across the whole picker.
- **Day paging (desktop)**: `‹` / `›` arrows shift the visible window of day cards forward/back by some number of days (exact page size not specified in the mock — 3 cards shown at once is a reasonable default). Disable/dim the arrow at either end of the available range.
- **"Отиди на дата" (Jump to date)**: opens a date picker (e.g. a calendar popover) letting the client jump directly to a specific date rather than paging day by day. Exact popover UI not designed in this mock — use the codebase's existing date-picker component/pattern.
- **"Покажи още дни" (Show more days, mobile)**: reveals additional day cards below the fold — implement as either progressive reveal (append more cards to the list) or infinite scroll.
- **No-availability days**: not interactive — no hover/press state, no chips to select.
- **Timezone disclosure**: static text reflecting the practitioner's or client's timezone (mock shows "Europe/Sofia (your timezone)"); should update dynamically based on actual detected/selected timezone.
- **Selecting a time is expected to lead into a confirm/continue step** (not shown in this specific mock's markup, but implied by the flow name "pick day → pick time → confirm") — check with design/product for the confirm screen's exact layout, or reference the other explored directions (3b, 3c) if available, which do show an explicit "Продължи" (Continue) button bar.
- **Responsive breakpoint**: switch from the desktop multi-column day-card row to the mobile vertical single-column stack at the codebase's existing mobile breakpoint (commonly ~768px, but defer to existing conventions).

## State Management
Suggested state shape (adapt to codebase patterns — Redux/Zustand/component state/etc.):
- `visibleDayWindowStart: Date` — which days are currently paged into view (desktop).
- `days: Array<{ date: Date, weekdayLabel: string, dateLabel: string, slots: Array<{ time: string, available: boolean }> }>` — fetched availability data per day.
- `selectedSlot: { date: Date, time: string } | null` — the currently chosen time.
- `visibleDayCount: number` (mobile) — how many day cards have been revealed via "show more."
- **Data fetching**: availability per day/time should be fetched from the practitioner's real calendar/scheduling backend (source of truth for which slots are open, booked, or blocked). Empty-state day cards ("Няма свободни часове") should render whenever a fetched day has zero open slots.
- **Locale**: all copy shown is Bulgarian (`bg`); an English locale file is included for reference (`i18n/en.json`) — confirm with the team whether this component needs bg/en toggling or is Bulgarian-only for now.

## Design Tokens
Full token files are included in `tokens/` (`colors.css`, `spacing.css`, `typography.css`, `fonts.css`) — import these directly or port their values into the target codebase's existing token/theming system rather than hardcoding.

Values used specifically in this component (light theme):
- `--bg-page`: oklch(98% 0.006 90) — page/section background
- `--bg-surface`: oklch(100% 0 0) — available day-card background
- `--bg-sunken`: oklch(93% 0.012 90) — no-availability day-card background
- `--border-subtle`: oklch(91% 0.006 90) — available day-card border
- `--border-default`: oklch(85% 0.008 90) — no-availability day-card dashed border
- `--text-primary`: oklch(20% 0.01 90) — date label
- `--text-tertiary`: oklch(56% 0.01 90) — weekday label, timezone text, no-availability copy
- `--accent`: oklch(55% 0.15 85) — selected time chip background, links
- `--accent-subtle`: oklch(93% 0.05 85) — unselected time chip background
- `--accent-subtle-text`: oklch(38% 0.11 85) — unselected time chip text
- `--text-on-accent`: oklch(100% 0 0) — selected time chip text
- `--radius-xl`: 20px — desktop day card
- `--radius-lg`: 14px — mobile day card
- `--radius-pill`: 999px — time chips
- Typography: `--text-caption` (400 12px/1.5), `--text-label` (600 13px/1.3), UI font is Manrope (see `fonts.css`), display font is PT Serif (not used in this component — all text here is UI weight)
- Dark theme equivalents for every token above are defined in `colors.css` under `[data-theme="dark"]` — this component should support both themes per the platform's existing theme system.

## Assets
No images or icons beyond the "‹ ›" paging glyphs and the underline-link affordance — both are plain text/CSS, no image assets required.

## Files
- `Slot Picker 3a — Reference.html` — standalone HTML reference (desktop + mobile frames), open directly in a browser.
- `tokens/` — design tokens (colors, spacing, typography, fonts) referenced by the HTML file.
- `i18n/bg.json`, `i18n/en.json` — reference locale files for the surrounding product; the copy strings used in this component (e.g. "Отиди на дата", "Няма свободни часове", "Покажи още дни") should be added to/sourced from the app's real i18n system rather than hardcoded.

Source of truth for this design lives in `Practitioner Profile Directions.dc.html` (option id `3a`) in the main project, alongside two alternative directions (3b, 3c) that were considered but not chosen for this handoff.
