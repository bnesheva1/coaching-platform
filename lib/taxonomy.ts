import specialtiesData from "@/data/specialties.json";
import topicsData from "@/data/topics.json";

// A taxonomy entry as stored in data/specialties.json / data/topics.json.
// The label lives in the existing flat en/bg fields; slug + intro are
// OPTIONAL additions that turn an entry into a category landing page.
type RawTaxonomyEntry = {
  key: string;
  en: string;
  bg: string;
  // Transliterated Latin slug, shared across locales (/bg/taro and /en/taro
  // — never a per-locale mapping; Cyrillic URLs percent-encode into gibberish
  // when shared).
  slug?: string;
  // A few sentences of real intro copy per locale — the thing the page ranks
  // on. Without it the page is a bare card grid.
  intro?: { bg: string; en: string };
};

export type TaxonomyKind = "specialty" | "topic";

// Top-level route segments that sit ALONGSIDE the dynamic /[locale]/[category]
// route. Next.js resolves a static segment before a dynamic one, so a category
// slugged e.g. "browse" wouldn't error — it'd silently lose: the static route
// wins, the category page becomes unreachable, and its sitemap/footer link points
// at the wrong page. So a slug matching one of these earns NO landing page.
// KEEP IN SYNC when a top-level route is added/removed under app/[locale]/ —
// scripts/verify-taxonomy.mjs asserts this covers every real route (fails on drift).
export const RESERVED_CATEGORY_SLUGS = new Set<string>([
  "about",
  "account-deleted",
  "admin",
  "become-a-practitioner",
  "browse",
  "client-dashboard",
  "contact",
  "cookie-preferences",
  "design-system",
  "faq",
  "forgot-password",
  "how-it-works",
  "immediate",
  "login",
  "p",
  "practitioner-dashboard",
  "privacy",
  "reset-password",
  "session",
  "settings",
  "signup",
]);

export function isReservedSlug(slug: string): boolean {
  return RESERVED_CATEGORY_SLUGS.has(slug.toLowerCase());
}

export type LandingEntry = {
  kind: TaxonomyKind;
  key: string;
  slug: string;
  label: { bg: string; en: string };
  intro: { bg: string; en: string };
};

// A taxonomy entry earns a landing page ONLY when it has both a slug and a
// bilingual intro. Missing either -> no page (we OMIT rather than fall back:
// an auto-transliterated slug is easy to get wrong and hard to change once
// indexed, and an intro-less page is thin content that hurts more than it
// helps — so a new specialty stays out of the landing set until authored,
// while still working everywhere else).
function toLandingEntry(kind: TaxonomyKind, raw: RawTaxonomyEntry): LandingEntry | null {
  if (!raw.slug || !raw.intro?.bg?.trim() || !raw.intro?.en?.trim()) return null;
  if (isReservedSlug(raw.slug)) {
    // Omit rather than let it silently shadow a real route (see the reserved set
    // above). Logged loudly so an authoring mistake is visible, and asserted in
    // verify-taxonomy.mjs so it can't reach production unnoticed.
    console.error(`taxonomy: category slug "${raw.slug}" collides with a reserved route — landing page omitted`);
    return null;
  }
  return { kind, key: raw.key, slug: raw.slug, label: { bg: raw.bg, en: raw.en }, intro: raw.intro };
}

// Every category landing page there is, derived from the taxonomy data — so
// adding a specialty/topic (with slug + intro) produces its page, sitemap
// entry and homepage/browse links automatically, with no route-code change.
export const landingEntries: LandingEntry[] = [
  ...(specialtiesData as RawTaxonomyEntry[]).map((s) => toLandingEntry("specialty", s)),
  ...(topicsData as RawTaxonomyEntry[]).map((t) => toLandingEntry("topic", t)),
].filter((e): e is LandingEntry => e !== null);

export const topicLandingEntries = landingEntries.filter((e) => e.kind === "topic");

export function landingEntryBySlug(slug: string): LandingEntry | undefined {
  return landingEntries.find((e) => e.slug === slug);
}
