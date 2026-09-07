import domainsData from "@/data/domains.json";

// Brand-two homepage "Попитай специалист" section (design handoff 1b, revised):
// a row of DOMAIN pills above a grid of one tile PER SPECIALTY. Both are data-
// driven — the pills from the active domains in data/domains.json, the tiles from
// HOME_MODALITIES below (which mirror data/specialties.json + the vet exception).
//
// landingPath is /browse pre-filtered by specialty key(s); repeated ?specialty
// params are OR-ed by browse (no backend domain filter needed). null landingPath
// + comingSoon = a non-link "coming soon" tile (veterinarian — not a real
// specialty yet).

export type ModalityIcon =
  | "brain"
  | "moon-star"
  | "paw-print"
  | "sparkles"
  | "hand-heart"
  | "coffee"
  | "palette"
  | "target";

export type HomeModality = {
  id: string;
  icon: ModalityIcon;
  label: { bg: string; en: string };
  landingPath: string | null;
  comingSoon?: boolean;
};

// One tile per real specialty (data/specialties.json), in curated order, each
// linking to its own /browse filter — plus the veterinarian "coming soon"
// exception (not a real specialty). Coffee-reading / art-therapist will show zero
// results until specialists are tagged; that's expected.
export const HOME_MODALITIES: HomeModality[] = [
  { id: "astrology", icon: "moon-star", label: { bg: "Астрология", en: "Astrology" }, landingPath: "/browse?specialty=astrology" },
  { id: "tarot", icon: "sparkles", label: { bg: "Таро", en: "Tarot" }, landingPath: "/browse?specialty=tarot" },
  { id: "reiki", icon: "hand-heart", label: { bg: "Рейки", en: "Reiki" }, landingPath: "/browse?specialty=reiki" },
  { id: "coffee_reading", icon: "coffee", label: { bg: "Гледане на кафе", en: "Coffee reading" }, landingPath: "/browse?specialty=coffee_reading" },
  // Points at the dedicated /psiholog taxonomy landing page (slug in
  // data/specialties.json) rather than a raw /browse filter. When another
  // specialty gets its own landing page, repoint its tile the same way.
  { id: "psychologist", icon: "brain", label: { bg: "Психолог", en: "Psychologist" }, landingPath: "/psiholog" },
  { id: "art_therapist", icon: "palette", label: { bg: "Арт-терапевт", en: "Art therapist" }, landingPath: "/browse?specialty=art_therapist" },
  { id: "coaching", icon: "target", label: { bg: "Коучинг", en: "Coaching" }, landingPath: "/browse?specialty=coaching" },
  { id: "veterinarian", icon: "paw-print", label: { bg: "Ветеринарен лекар", en: "Veterinarian" }, landingPath: null, comingSoon: true },
];

// Domain pills — one per ACTIVE domain (data/domains.json), each linking to a
// /browse result OR-filtered across every specialty in the domain. Just repeated
// ?specialty= keys; no backend domain filter needed.
type DomainEntry = { key: string; bg: string; en: string; active: boolean; specialties: string[] };
export const DOMAIN_PILLS = (domainsData as DomainEntry[])
  .filter((d) => d.active)
  .map((d) => ({
    key: d.key,
    label: { bg: d.bg, en: d.en },
    landingPath: `/browse?${d.specialties.map((s) => `specialty=${s}`).join("&")}`,
  }));
