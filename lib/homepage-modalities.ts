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
  // For a curated tile that isn't a real specialty (the veterinarian
  // placeholder): the data/domains.json domain it stands in for, so the
  // roster classifier can inherit that domain's (master-switch-gated) state.
  domainKey?: string;
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
  { id: "psychologist", icon: "brain", label: { bg: "Психолог", en: "Psychologist" }, landingPath: "/browse?specialty=psychologist" },
  { id: "art_therapist", icon: "palette", label: { bg: "Арт-терапевт", en: "Art therapist" }, landingPath: "/browse?specialty=art_therapist" },
  { id: "coaching", icon: "target", label: { bg: "Коучинг", en: "Coaching" }, landingPath: "/browse?specialty=coaching" },
  { id: "veterinarian", icon: "paw-print", label: { bg: "Ветеринарен лекар", en: "Veterinarian" }, landingPath: null, comingSoon: true, domainKey: "veterinary" },
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

// Join active-domain labels into a natural-language list, e.g.
// "Интуитивни практики, Психология и Коучинг" — for static pages (/about,
// /become-a-practitioner) that can't embed the DOMAIN_PILLS links themselves
// (e.g. a meta description). Labels + order come straight from DOMAIN_PILLS, so
// it stays accurate as domains activate/deactivate, with no hand-typed list.
export function joinDomainLabels(labels: string[], locale: "bg" | "en"): string {
  const conjunction = locale === "bg" ? "и" : "and";
  if (labels.length <= 1) return labels[0] ?? "";
  return `${labels.slice(0, -1).join(", ")} ${conjunction} ${labels[labels.length - 1]}`;
}
