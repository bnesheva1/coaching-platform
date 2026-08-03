# Handoff: Practitioner Profile (client-facing) — direction 2a

## Overview
Public practitioner profile page for **Прозрения**, a Bulgarian-first marketplace where clients
book sessions with spiritual/wellness practitioners (tarot, astrology, energy work).
The page must let a seeker judge a person quickly (face, voice, specialty, rating, delivery mode)
and book a concrete time slot without leaving the page.

This bundle replaces an already-built version of the page that read as flat and admin-like:
tall empty banner with the quote lost inside it, avatar floating in whitespace, thin-bordered
boxes, a grey full-width "Available times" bar instead of real slots, no service imagery.

**Implement direction `2a`** (top section of the reference file). Options `1a`/`1b`/`1c` below it are
earlier explorations kept for context only — do not build them.

## About the Design Files
The files in this bundle are **design references created in HTML** — prototypes that show intended
look and behavior, not production code to copy. The task is to **recreate them in the target
codebase's existing environment** (React/Vue/etc.) using its established component patterns,
routing, i18n and data layer. If no environment exists yet, pick the framework that best fits the
product and implement there. Mock data in the prototype (names, reviews, slots) must come from the API.

## Fidelity
**High fidelity.** Colors, typography, spacing, radii and shadows are final and all come from the
Прозрения token set (`tokens/*.css`, included). Recreate pixel-faithfully; use the tokens, not literals.
Only three things are placeholders: the portrait, the banner artwork, and the two service images
(rendered as `.ph` gradient blocks labelled "портрет" / "снимка на услугата").

## Screens / Views

### Practitioner profile (single scrolling page, public/client-facing)
**Purpose:** evaluate the practitioner and book a slot for a specific service.
**Container:** max content width 820px, centered, `background: var(--bg-page)`. Page has one column;
the identity block splits into content + facts card on desktop.

Vertical order:

1. **Cover banner**
   - `margin: 30px` (inset from the page edges on all sides), `height: 176px`,
     `border-radius: var(--radius-xl)`, `overflow: hidden`.
   - Background `linear-gradient(105deg, oklch(94% 0.03 82), oklch(88% 0.065 72))`; a decorative
     right-edge panel 220px wide, `opacity: .45`,
     `linear-gradient(160deg, oklch(90% 0.05 80), oklch(78% 0.075 66))`, `aria-hidden="true"`.
   - **No text inside the banner.** (This was the main defect of the built version.)
   - When the practitioner uploads a cover image, it replaces the gradient (`object-fit: cover`).

2. **Identity row** — `padding: 0 40px`, flex, `align-items: flex-end`, `gap: 22px`,
   `margin-top: -62px` so the portrait overlaps the banner (Facebook-style cover header).
   - Portrait: 140×140, `border-radius: 50%`, `border: 6px solid var(--bg-page)`,
     `box-shadow: var(--shadow-md)`, never shrinks (`flex: none`).
   - Beside it (`padding-bottom: 12px`): `h1` name `var(--text-display-sm)` /
     `var(--text-primary)`; below it the specialty line, `600 14px var(--font-ui)`, `var(--accent)`.

3. **Intro block** — `padding: 26px 40px 34px`, flex row, `gap: 34px`, `align-items: flex-start`.
   - **Left column** (`flex: 1`, `gap: 22px`):
     - Pull quote: `italic 400 20px/1.5 var(--font-display)`, `var(--text-primary)`,
       `max-width: 440px`, `text-wrap: pretty`. This is the quote that used to sit in the banner.
     - Two **labelled pill rows**, `gap: 14px` between them. Each row: flex, `align-items: flex-start`,
       `gap: 10px`; label is `var(--text-overline)` + `letter-spacing: var(--letter-overline)`,
       uppercase, `var(--text-tertiary)`, fixed `width: 82px`, `padding-top: 7px`; the pill container
       is `flex: 1` with `flex-wrap: wrap` so pills wrap to a second line beside the label, never under it.
       - **Практики** (specialties — what the practitioner practices): `.pill-spec` — solid
         `var(--accent)` on `var(--text-on-accent)`, `600 12px var(--font-ui)`, `padding: 6px 14px`,
         `border-radius: 999px`.
       - **Теми** (topics — what clients come about): `.pill-topic` — `var(--bg-surface-2)` /
         `var(--text-secondary)`, `500 12px`, same padding/radius, `box-shadow: var(--shadow-sm)`.
       - These two taxonomies are **distinct data** and must stay visually distinct.
     - Secondary action: "Запази практикуващ" (save/favourite) — `.ghostbtn`: `var(--bg-surface)`,
       `var(--text-primary)`, `600 13px`, `padding: 13px 20px`, `border-radius: 10px`,
       `box-shadow: var(--shadow-sm)`, `min-height: 44px`, heart icon stroked in `var(--accent)`.
   - **Right facts card** (`width: 248px`, `flex: none`, `var(--bg-surface)`,
     `border-radius: var(--radius-lg)`, `box-shadow: var(--shadow-sm)`, `padding: 20px`, `gap: 18px`),
     in this exact order:
     1. Rating — gold stars (`var(--accent)`, 13px, `letter-spacing: 1px`), score `700 18px var(--font-ui)`,
        then review count as a link to the reviews section (`var(--text-caption)`).
     2. Delivery-mode badges — `.mode-badge` (`var(--accent-subtle)` / `var(--accent-subtle-text)`,
        `600 11.5px`, `padding: 5px 11px`, `border-radius: 999px`, 13px stroked icon + label):
        "Онлайн" (monitor icon) and "На място — София" (map-pin icon; the city comes from the profile).
        Render only the modes the practitioner actually offers.
     3. Next available slot — overline label "Следващ свободен час", then the value
        `400 19px/1.3 var(--font-display)` preceded by a 17px calendar icon stroked in `var(--accent)`;
        caption below shows the timezone ("Europe/Sofia"). **The value is the first free slot of the
        availability table below** (same source of truth — do not compute it separately).
     4. Primary CTA "Виж свободни часове" — `.goldbtn`: `var(--accent)` / `var(--text-on-accent)`,
        `600 13px`, `padding: 13px 22px`, `border-radius: 10px`, `min-height: 44px`,
        `box-shadow: var(--shadow-sm)`, full card width, anchors to the services section.
     - The gold CTA exists **only here** in the intro — do not duplicate it in the left column.

4. **Sections below** — `padding: 8px 40px 42px`, stacked with `gap: 44px`.
   **No horizontal rule/separator lines anywhere** — spacing alone separates sections.
   Section headings: `var(--text-heading-lg)`, `var(--text-primary)`.

   - **Относно мен** — body copy `var(--text-body-md)`, `var(--text-secondary)`,
     `max-width: 600px`, `text-wrap: pretty`.

   - **Услуги** — service cards stacked with `gap: 18px`. Each card: `var(--bg-surface)`,
     `border-radius: var(--radius-xl)`, `box-shadow: var(--shadow-sm)`, `padding: 20px`, **no border**.
     Header row: service image 152×114, `border-radius: 12px`, `flex: none`, then a column with
     name (`var(--text-heading-lg)`), a meta line (`var(--text-body-sm)` / `var(--text-tertiary)`:
     "45 мин. · 60,00 €") followed by **one** mode badge (10.5px, `padding: 3px 8px`), then the
     description (`var(--text-body-sm)` / `var(--text-secondary)`).
     - A service is **either online or in-person, never both**: service 1 = "Онлайн" (monitor icon),
       service 2 = "На място — София" (map-pin icon).
     - **Expanded state (service 1)** — inline availability picker, `margin-top: 20px`, all on
       `var(--bg-surface)` (**no grey panel**), `padding: 18px 0 0`:
       - Header: "Избери свободен час" (`var(--text-heading-sm)`) + caption
         "Часовете са показани в Europe/Sofia"; right-aligned toggle link
         "Скрий свободните часове ⌃" (`600 12px var(--font-ui)`, `var(--accent)`).
       - Body: prev/next circular `.arrow` buttons (26px, `var(--bg-surface)`,
         `box-shadow: var(--shadow-sm)`, chevron icon, aria-labels "Предишни дни" / "Следващи дни")
         flanking a `grid-template-columns: repeat(3, 1fr)`, `gap: 12px` of **day cards**:
         `var(--bg-surface)` + `border: 1px solid var(--border-subtle)` + `border-radius: 12px`,
         `padding: 14px` — **bordered, not shadowed**. Each has weekday (`var(--text-caption)` /
         `var(--text-tertiary)`), date (`var(--text-heading-sm)`), then wrapped time pills.
       - Time pill `.slot`: `600 12px var(--font-ui)`, `padding: 6px 12px`, `border-radius: 999px`,
         `var(--accent-subtle)` / `var(--accent-subtle-text)`; **hover/focus** inverts to
         `var(--accent)` / `var(--text-on-accent)`. Selecting a slot starts booking.
       - Footer link, right-aligned: "Отиди на дата" (opens a date jump / full calendar).
     - **Collapsed state (service 2)** — right-aligned link "Виж свободни часове ⌄" preceded by a
       14px calendar icon; expanding renders the same picker for that service. Only one service
       expanded at a time (accordion).

   - **Отзиви** — heading row with heading left and "**4.9** (N отзива)" right
     (score `700 15px var(--font-ui)` / `var(--text-primary)`, rest `var(--text-body-sm)` /
     `var(--text-tertiary)`). Rating and count must come from one source of truth and match everywhere.
     - **Collapsed (default):** the **6 most recent** reviews as a `repeat(3, 1fr)` grid, `gap: 14px`.
       Card: `var(--bg-surface)`, `border-radius: var(--radius-lg)`, `box-shadow: var(--shadow-sm)`,
       `padding: 16px 18px`, `gap: 8px`: gold stars (12px) → review text
       (`var(--text-body-sm)` / `var(--text-secondary)`, `flex: 1`) → "Потвърден потребител · <date>"
       (`var(--text-caption)` / `var(--text-tertiary)`). Below, centered `.ghostbtn`-styled button
       "Виж всички отзиви (N)" where N = total review count.
     - **Expanded:** the full list as flat rows, each `padding: 14px 0` with
       `border-top: 1px solid var(--border-subtle)` — the single place in the page where separator
       lines are allowed. Row: meta line "★★★★★ — Потвърден потребител · <date>" then the text.
       Centered "Покажи по-малко" button collapses back to the grid.

## Interactions & Behavior
- **Availability accordion:** per-service expand/collapse; expanding one collapses the other.
  Prev/next paginate the 3-day window; "Отиди на дата" opens a date picker.
- **Slot select:** pill click → booking flow for that service + datetime (auth gate if signed out).
- **Save practitioner:** toggles favourite; filled heart when saved (auth gate if signed out).
- **Reviews:** "Виж всички отзиви (N)" swaps grid → full list; "Покажи по-малко" reverses.
  Fetch the remaining reviews on expand if the API paginates.
- **Anchors:** the facts-card CTA scrolls to Услуги; the review-count link scrolls to Отзиви.
  Use programmatic smooth scroll, not `scrollIntoView` inside embedded contexts.
- **Hover:** `.slot` inverts to solid accent; `.goldbtn` → `var(--accent-hover)`;
  `.ghostbtn`/`.arrow` → `var(--bg-surface-2)`. All transitions ~150ms ease-out.
- **Responsive (mobile-first):** below ~720px — banner margin 16px and height ~120px; portrait
  ~96px with the name stacked beneath it (no overlap row); the facts card becomes a full-width block
  directly under the quote; pill labels sit above their pills; availability shows a horizontal
  scroll/swipe of day cards (one card ≈ 78% width); reviews grid becomes 1 column; consider a
  sticky bottom bar with the next slot + "Виж свободни часове".
- **Accessibility:** all hit targets ≥44px (pills get a padded tap area on touch); day-card slots are
  real `<button>`s; arrows have aria-labels; decorative banner layer `aria-hidden`; accordion
  toggles expose `aria-expanded` + `aria-controls`; the star rating is accompanied by text
  ("4.9 от 5, N отзива") for screen readers; visible focus ring `var(--focus-ring)`.
- **Both themes:** every color is a token, so `[data-theme="dark"]` works with no extra rules.
  Verify the banner gradient in dark — swap it for a dark-tinted variant if it reads too bright.

## State Management
- `expandedServiceId: string | null` — which service shows its availability.
- `slotWindowStart: Date` (per service) — start of the visible 3-day window.
- `reviewsExpanded: boolean` — grid vs. full list.
- `isSaved: boolean` — favourite state (optimistic, reconcile with server).
- Derived: `nextAvailableSlot` = first slot of the availability response (feeds the facts card),
  `reviewCount` / `ratingAverage` = one source for header, facts card and expand button.
- Data: practitioner profile (name, specialty line, quote, bio, specialties[], topics[], modes[],
  city, portrait, cover), services[] (name, duration, price, mode, city, image, description),
  availability per service (timezone-aware, Europe/Sofia display), reviews (paginated, newest first).

## Design Tokens
Use `tokens/colors.css`, `tokens/typography.css`, `tokens/spacing.css`, `tokens/fonts.css`
(bundled here) — light + dark are already defined. Key values as rendered in light theme:
- Accent `oklch(55% 0.15 85)`; accent-subtle `oklch(93% 0.05 85)` with text `oklch(38% 0.11 85)`.
- Page `oklch(98% 0.006 90)`; surface `#fff`; surface-2 `oklch(95.5% 0.01 90)`.
- Text primary `oklch(20% 0.01 90)`, secondary `oklch(42% 0.012 90)`, tertiary `oklch(56% 0.01 90)`.
- Border subtle `oklch(91% 0.006 90)`.
- Display font PT Serif, UI font Manrope (Cyrillic-safe).
- Radii: cards `--radius-xl`, panels/facts `--radius-lg`, buttons 10px, day cards 12px, pills 999px.
- Shadows: `--shadow-sm` on cards, `--shadow-md` on the portrait ring. Only day cards use a border.
- Local spacing rhythm: 30px banner inset, 40px page gutter, 44px between sections,
  18–22px inside cards.

## Assets
- **Icons** — inline SVG, Lucide-style, 1.5–2px stroke, `currentColor`: monitor (online),
  map-pin (in person), calendar (next slot / see availability), heart (save), chevrons (paginate).
  Substitute the codebase's icon library with the same shapes/weights.
- **Images** — none shipped. Needed: practitioner portrait (square, ≥560px), optional cover image
  (≥1640×352), one image per service (4:3, ≥608×456). Placeholders in the prototype mark each spot.
- **Stars** — text glyphs in the mock; use icon components in production for accessibility.

## Files
- `Practitioner Profile Fix Directions.dc.html` — the reference. **Build direction `2a`** (first
  section, id `#2a`); `1a`/`1b`/`1c` below are earlier explorations, context only.
- `styles.css` + `tokens/` — the Прозрения token set the design is built on.
- `support.js` — runtime needed to open the reference HTML locally; not for production.
- Related existing references in the parent project: `Card2a.dc.html` (browse card, the aesthetic
  this page matches), `Practitioner Profile.dc.html` (older owner-editable version).
