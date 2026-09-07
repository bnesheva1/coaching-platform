import specialtiesData from "@/data/specialties.json";
import topicsData from "@/data/topics.json";

// A localized string pair. Every piece of author-facing landing copy carries
// both locales — the model refuses to build a page missing either (see below).
type Localized = { bg: string; en: string };

export type LandingFaqItem = { q: Localized; a: Localized };

// The rich landing content authored per taxonomy entry, nested under `landing`
// in data/specialties.json / data/topics.json. Its PRESENCE (with every field
// filled, both locales) is what turns a plain taxonomy entry into a category
// landing page — see landingEntries below.
type RawLanding = {
  // Transliterated Latin slug, shared across locales (/psiholog — never a
  // Cyrillic URL that percent-encodes into gibberish when shared).
  slug?: string;
  metaTitle?: Localized;
  metaDescription?: Localized;
  h1?: Localized;
  intro?: Localized;
  whyOnlineHeading?: Localized;
  whyOnlineBody?: Localized;
  faq?: LandingFaqItem[];
};

type RawTaxonomyEntry = {
  key: string;
  en: string;
  bg: string;
  landing?: RawLanding;
};

export type TaxonomyKind = "specialty" | "topic";

// Top-level route segments that sit ALONGSIDE the dynamic /[locale]/[category]
// route — plus the non-locale ones (/api, /auth, /supabase-test) that collapse
// onto the same single-segment path space under this brand's no-prefix routing.
// Next resolves a static segment before a dynamic one, so a category slugged
// e.g. "browse" wouldn't error — it'd silently lose: the static route wins, the
// category page becomes unreachable, and its sitemap/internal links point at
// the wrong page. So a slug matching one of these earns NO landing page.
// KEEP IN SYNC when a top-level route is added/removed under app/.
export const RESERVED_CATEGORY_SLUGS = new Set<string>([
  "about",
  "account-deleted",
  "admin",
  "api",
  "auth",
  "become-a-practitioner",
  "bookings",
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
  "supabase-test",
]);

export function isReservedSlug(slug: string): boolean {
  return RESERVED_CATEGORY_SLUGS.has(slug.toLowerCase());
}

export type LandingEntry = {
  kind: TaxonomyKind;
  key: string;
  slug: string;
  label: Localized;
  metaTitle: Localized;
  metaDescription: Localized;
  h1: Localized;
  intro: Localized;
  whyOnlineHeading: Localized;
  whyOnlineBody: Localized;
  faq: LandingFaqItem[];
};

function bothLocales(v?: Localized): v is Localized {
  return !!v && !!v.bg?.trim() && !!v.en?.trim();
}

// A taxonomy entry earns a landing page ONLY when its `landing` block is
// complete — a slug + bilingual meta/h1/intro/why-online + at least one FAQ,
// each with both locales. Missing any piece -> no page (we OMIT rather than
// fall back: a half-authored page is thin content that hurts more than it
// helps, and an auto-transliterated slug is easy to get wrong and hard to
// change once indexed). So a new specialty stays out of the landing set until
// fully authored, while still working everywhere else (browse, profiles,
// filters). Collisions/omissions are logged loudly and asserted in
// scripts/verify-taxonomy.mjs so an authoring mistake can't ship unnoticed.
function toLandingEntry(kind: TaxonomyKind, raw: RawTaxonomyEntry): LandingEntry | null {
  const l = raw.landing;
  if (!l || !l.slug) return null;
  const { slug, metaTitle, metaDescription, h1, intro, whyOnlineHeading, whyOnlineBody, faq } = l;
  // Each guard narrows its field for the return below (destructured consts +
  // an early-returning `||` chain — TS carries the narrowing through).
  if (
    !bothLocales(metaTitle) ||
    !bothLocales(metaDescription) ||
    !bothLocales(h1) ||
    !bothLocales(intro) ||
    !bothLocales(whyOnlineHeading) ||
    !bothLocales(whyOnlineBody) ||
    !faq ||
    faq.length === 0 ||
    !faq.every((f) => bothLocales(f.q) && bothLocales(f.a))
  ) {
    console.error(`taxonomy: entry "${raw.key}" has an incomplete landing block — landing page omitted`);
    return null;
  }
  if (isReservedSlug(slug)) {
    console.error(`taxonomy: category slug "${slug}" collides with a reserved route — landing page omitted`);
    return null;
  }
  return {
    kind,
    key: raw.key,
    slug,
    label: { bg: raw.bg, en: raw.en },
    metaTitle,
    metaDescription,
    h1,
    intro,
    whyOnlineHeading,
    whyOnlineBody,
    faq,
  };
}

// Every category landing page there is, derived from the taxonomy data — so
// authoring a specialty/topic's `landing` block produces its page, sitemap
// entry and internal links automatically, with no route-code change.
export const landingEntries: LandingEntry[] = [
  ...(specialtiesData as RawTaxonomyEntry[]).map((s) => toLandingEntry("specialty", s)),
  ...(topicsData as RawTaxonomyEntry[]).map((t) => toLandingEntry("topic", t)),
].filter((e): e is LandingEntry => e !== null);

export function landingEntryBySlug(slug: string): LandingEntry | undefined {
  return landingEntries.find((e) => e.slug === slug);
}

// Lookup by specialty/topic KEY (not slug) — used to reuse a landing entry's
// authored copy elsewhere (e.g. the /browse single-specialty context header).
// This is copy reuse, NOT a nav link, so it doesn't touch the no-link rule below.
export function landingEntryByKey(key: string): LandingEntry | undefined {
  return landingEntries.find((e) => e.key === key);
}

// NOTE: internal navigation NEVER links to a taxonomy landing page — pills,
// tiles and in-page links always point at /browse. Taxonomy pages are entry
// points for external/organic search only (they embed their own practitioner
// grid). So there is deliberately no "landingPathForKey" nav helper here.
