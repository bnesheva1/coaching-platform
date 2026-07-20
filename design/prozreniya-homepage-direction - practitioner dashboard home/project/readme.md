# Прозрения (Prozreniya) — Design System

Bilingual (BG/EN) booking marketplace connecting seekers (love, career, business, life direction, energy, inner balance) with spiritual & wellness practitioners (tarot, astrology, reiki/energy work, coaching) in Bulgaria. Structural model: doctolib.de (search-first marketplace). Visual model: resend.com — deep black, generous whitespace, restrained type — warmed toward a human/wellness audience with a gold accent, and explicitly avoiding mystical-kitsch clichés (crystal balls, purple neon, tarot imagery).

Origin: extracted from the approved hero direction **1b** ("warm humanist") in `Hero Directions.dc.html` at project root — kept for reference, not part of the system.

Both light and dark themes are first-class; toggle via `[data-theme="dark"]` on any ancestor (defaults to light).

## Index
- `styles.css` — single entry point, imports all tokens
- `tokens/` — `fonts.css`, `colors.css`, `typography.css`, `spacing.css` (incl. radii, shadow, motion)
- `components/core/` — Button, Input, Card, Chip
- `components/navigation/` — NavBar
- `guidelines/` — foundation specimen cards (colors, type, spacing/radii, wordmark)
- `SKILL.md` — Claude Code / Agent Skill packaging

## Content fundamentals
- **Bulgarian-first.** All UI copy authored in Bulgarian; English is a toggle, not an afterthought. Copy in this system is placeholder — a writer refines tone later.
- **Plain, direct language.** No mystical jargon or hype ("unlock your destiny"). Subheads state what the platform *is* (SEO-friendly, descriptive), not a slogan.
- **Second person, calm register.** Address the seeker directly but gently — this audience is often emotionally vulnerable; avoid urgency/pressure copy ("Now or never", exclamation marks).
- **No emoji.** Never part of this brand's voice.
- **Real questions, not generic categories**, drive the hero (e.g. "Това ли е човекът за мен?") — concrete and human, not abstract ("Find your path").

## Visual foundations
- **Type**: PT Serif for display/headlines (warm, editorial, humanist serif — a deliberate departure from resend's sans-only system, chosen because it renders confident, legible Cyrillic and reads as trustworthy rather than mystical). Manrope for all UI/body text (clean, neutral, excellent Cyrillic support). Never more than these two families.
- **Color**: one accent hue only — gold (~oklch hue 85), never blue, never purple. Gold is accent-only: buttons, active states, overline labels, focus rings, chip-selected state — **never body text** (fails contrast at readable sizes and reads as decorative, not informational). Neutrals are warm-tinted grays (hue ~90), not cool/blue grays — keeps the "premium calm" of Resend but feels human rather than clinical.
- **Backgrounds**: flat color only. No photography, no illustration, no gradients as backgrounds — the one deliberate exception is a soft radial "gold glow" (`--accent-glow`) used sparingly near hero content, evoking warmth without imagery.
- **Spacing**: generous, 4px-base scale (see `tokens/spacing.css`). Hero and section padding lean toward the larger end (`--space-16`/`--space-20`+) — whitespace is a feature, not a gap to fill.
- **Corners**: soft but not bubbly. `--radius-md` (10px) for inputs/buttons, `--radius-xl` (20px) for cards, `--radius-pill` for chips/toggles only.
- **Shadows**: very restrained — `--shadow-sm`/`md`/`lg` are soft, low-opacity, used only on the search bar and elevated cards. No hard drop shadows.
- **Motion**: fast, standard-eased transitions only (`--duration-fast`/`--duration-base`, `--ease-standard`). No bounce, no spring. The hero rotating-question animation is the one expressive motion moment — cross-fades on a ~15s cycle, and must degrade to a static first question under `prefers-reduced-motion`.
- **Focus/hover**: hover darkens (light theme) or lightens (dark theme) the accent by one step; never opacity-fades interactive elements. Focus is always a visible gold ring (`--focus-ring`), never removed.
- **Borders**: hairline (1px), warm-neutral, low-contrast by default (`--border-subtle`/`--border-default`); reserved for definition, not decoration.

## Iconography
No icon set has been supplied yet. The system currently uses zero custom icons/SVGs — the only glyph in use is a plain Unicode arrow (→) on the search button. **Do not hand-draw icons.** When practitioner-modality icons or UI icons (search, filter, chevron, star) are needed, either request real assets from the user or substitute a neutral, thin-stroke CDN set (e.g. Lucide/Feather) matching this system's restrained, non-mystical tone — flag any substitution.

## Logo
No logo file was provided. The wordmark is set in plain type (PT Serif 700, see `guidelines/wordmark.card.html`) everywhere a mark would go.

## Components
- **Button** (`components/core/Button.jsx`) — primary (solid gold) / secondary (outlined) / ghost; sm/md/lg.
- **Input** (`components/core/Input.jsx`) — standard field, or `search` variant (pill, embedded gold go-button, helper text).
- **Card** (`components/core/Card.jsx`) — eyebrow + title + description + footer; `tone="inverse"` for a dark block on a light page.
- **Chip** (`components/core/Chip.jsx`) — topic/filter pill, `selected` state gold-tinted.
- **NavBar** (`components/navigation/NavBar.jsx`) — wordmark, links, language toggle, Вход/Регистрация actions.

### Intentional additions
This is a from-scratch system (no source codebase/Figma) built to the user's explicit list — Button, Input, Card, Chip, Nav — sized to the homepage brief. No components beyond that list were added.

## Caveats / ask
- Fonts are loaded from Google Fonts CDN (no local binaries were supplied) — swap in licensed files if brand guidelines require it.
- No logo or icon assets exist yet — please attach if available.
- This system was extracted from a single hero direction; it hasn't yet been stress-tested across a full homepage or secondary pages (search results, practitioner profile, booking flow). Happy to extend components (Badge/Rating for practitioner cards, Select for filters, Tabs) once those screens are scoped.

Remember to set this file's type to **Design System** in the Share menu so others in your org can view it.
