// Curated modality tiles for the brand-two homepage hero (design handoff 1b).
// A deliberately SMALL launch set — not every specialty. Coaching and Reiki are
// real, bookable specialties and filterable on /browse, but are intentionally
// left OUT of the launch tiles (curation, not oversight — don't add them without
// a product decision).
//
// landingPath is where a tile links. It DEFAULTS to a filtered /browse URL, which
// works today with the existing browse route and needs no taxonomy landing page.
// When a dedicated taxonomy landing page ships for a modality, swapping its
// landingPath to that page's path (e.g. "/psiholog") is the ONLY change needed.
// null landingPath = "coming soon": rendered as a non-link, for a modality with
// zero bookable specialists.

// One rotating hero question. `word` is the single word on the line that carries
// the gradient (never the whole line). bg only — brand two's live locale.
export type HeroQuestion = { before: string; word: string; after: string };

export type HomeModality = {
  id: string;
  // Lucide icon name; the tile component maps this to the icon component.
  icon: "brain" | "moon-star" | "paw-print";
  label: { bg: string; en: string };
  landingPath: string | null;
  comingSoon?: boolean;
  // Whether this modality participates in the homepage hero (its questions cycle).
  // Distinct from comingSoon, which is about BOOKING: the veterinarian is active
  // in the hero (its question is a teaser) yet coming-soon for booking. Reserved
  // modalities (RESERVED_MODALITY_DRAFTS) stay inactive until they're ready.
  active: boolean;
  // Rotating hero questions for this modality. Only active modalities' questions
  // enter the rotation.
  heroQuestions?: HeroQuestion[];
};

export const HOME_MODALITIES: HomeModality[] = [
  {
    id: "psychologist",
    icon: "brain",
    label: { bg: "Психолог", en: "Psychologist" },
    // Real specialty key `psychologist` (data/specialties.json); backed by at
    // least one active, bookable practitioner.
    landingPath: "/browse?specialty=psychologist",
    active: true,
    heroQuestions: [
      { before: "Защо се чувствам ", word: "блокиран/а", after: "?" },
      { before: "Защо съм постоянно ", word: "тревожен", after: "?" },
    ],
  },
  {
    id: "astro-tarolog",
    icon: "moon-star",
    label: { bg: "Астро-таролог", en: "Astro-tarologist" },
    // A combined virtual tile: not one specialty key, but the union of two real
    // ones (astrology + tarot). Browse reads repeated ?specialty params as a set.
    landingPath: "/browse?specialty=astrology&specialty=tarot",
    active: true,
    heroQuestions: [
      { before: "Какво ме чака тази ", word: "година", after: "?" },
      { before: "Защо усещам, че се повтарят едни и същи ", word: "модели", after: " във връзките ми?" },
    ],
  },
  {
    id: "veterinarian",
    icon: "paw-print",
    label: { bg: "Ветеринарен лекар", en: "Veterinarian" },
    // No specialty, zero practitioners — coming-soon for booking, but its hero
    // question still cycles (active in the hero as a teaser).
    landingPath: null,
    comingSoon: true,
    active: true,
    heroQuestions: [
      { before: "Нормално ли е ", word: "кучето", after: " ми да не яде от два дни?" },
      { before: "Защо ", word: "котката", after: " ми се държи така?" },
    ],
  },
];

// Reserved modalities NOT yet in the launch set. Draft hero copy kept here (these
// were the old flat-pool placeholders removed from the active rotation) so it's
// ready when Lawyer / Real Estate activate — add them to HOME_MODALITIES with
// these as heroQuestions and active: true.
export const RESERVED_MODALITY_DRAFTS: Record<string, { label: { bg: string; en: string }; heroQuestions: HeroQuestion[] }> = {
  lawyer: {
    label: { bg: "Адвокат", en: "Lawyer" },
    heroQuestions: [{ before: "Мога ли да го ", word: "уволня", after: "?" }],
  },
  real_estate: {
    label: { bg: "Недвижими имоти", en: "Real estate" },
    heroQuestions: [{ before: "Струва ли си този ", word: "имот", after: "?" }],
  },
};
