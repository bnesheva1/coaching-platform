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

export type HomeModality = {
  id: string;
  // Lucide icon name; the tile component maps this to the icon component.
  icon: "brain" | "moon-star" | "paw-print";
  label: { bg: string; en: string };
  landingPath: string | null;
  comingSoon?: boolean;
};

export const HOME_MODALITIES: HomeModality[] = [
  {
    id: "psychologist",
    icon: "brain",
    label: { bg: "Психолог", en: "Psychologist" },
    // Real specialty key `psychologist` (data/specialties.json); backed by at
    // least one active, bookable practitioner.
    landingPath: "/browse?specialty=psychologist",
  },
  {
    id: "astro-tarolog",
    icon: "moon-star",
    label: { bg: "Астро-таролог", en: "Astro-tarologist" },
    // A combined virtual tile: not one specialty key, but the union of two real
    // ones (astrology + tarot). Browse reads repeated ?specialty params as a set.
    landingPath: "/browse?specialty=astrology&specialty=tarot",
  },
  {
    id: "veterinarian",
    icon: "paw-print",
    label: { bg: "Ветеринарен лекар", en: "Veterinarian" },
    // No specialty, zero practitioners — the one genuinely "coming soon" tile.
    landingPath: null,
    comingSoon: true,
  },
];
