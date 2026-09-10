import "server-only";
import { cache } from "react";
import { searchPractitioners } from "@/lib/practitioners/search";
import { HOME_MODALITIES } from "@/lib/homepage-modalities";
import specialtiesData from "@/data/specialties.json";
import domainsData from "@/data/domains.json";

// Roster-driven visibility for specialties/domains — no hardcoded list, no
// per-specialty schema. Recomputed from the live roster on each request:
//
//   active      — ≥1 approved (searchable) practitioner with the specialty is
//                  currently bookable.
//   coming_soon — ≥1 approved practitioner has the specialty, but none bookable.
//   hidden      — no approved practitioner has the specialty at all.
//
// Data source is the existing search_practitioners RPC (granted to anon/
// authenticated, already gates is_practitioner_searchable): one call with
// onlyBookable:false gives the approved set, one with onlyBookable:true gives
// the bookable set. "Bookable" is is_practitioner_bookable (profile complete +
// active service + availability calendar set + connect + moderation +
// subscription) — NOT a guarantee of a free future slot, matching how Browse
// itself gates. Both calls are cache()d per request so a page that needs
// specialty AND domain states pays for them once.
export type AvailabilityState = "active" | "coming_soon" | "hidden";

const loadRoster = cache(async (): Promise<{ approved: Set<string>; bookable: Set<string> }> => {
  const [approvedRows, bookableRows] = await Promise.all([
    searchPractitioners({ onlyBookable: false }),
    searchPractitioners({ onlyBookable: true }),
  ]);
  const approved = new Set<string>();
  for (const p of approvedRows) for (const k of p.specialties) approved.add(k);
  const bookable = new Set<string>();
  for (const p of bookableRows) for (const k of p.specialties) bookable.add(k);
  return { approved, bookable };
});

function classify(key: string, roster: { approved: Set<string>; bookable: Set<string> }): AvailabilityState {
  if (roster.bookable.has(key)) return "active";
  if (roster.approved.has(key)) return "coming_soon";
  return "hidden";
}

/** State for a single specialty key — the classifier's atomic unit. */
export const getSpecialtyState = cache(async (key: string): Promise<AvailabilityState> => {
  return classify(key, await loadRoster());
});

/** Every specialty in data/specialties.json → its state. */
export const getSpecialtyStates = cache(async (): Promise<Record<string, AvailabilityState>> => {
  const roster = await loadRoster();
  const out: Record<string, AvailabilityState> = {};
  for (const s of specialtiesData as { key: string }[]) out[s.key] = classify(s.key, roster);
  return out;
});

type DomainEntry = { key: string; active: boolean; specialties: string[] };

/**
 * Every domain in data/domains.json → its state, rolled up from its specialties:
 * active if any specialty is active, coming_soon if none active but ≥1
 * coming_soon, else hidden. The domain's own `active:false` flag is a MASTER
 * SWITCH: an inactive vertical is always hidden regardless of roster.
 */
export const getDomainStates = cache(async (): Promise<Record<string, AvailabilityState>> => {
  const roster = await loadRoster();
  const out: Record<string, AvailabilityState> = {};
  for (const d of domainsData as DomainEntry[]) {
    if (!d.active) {
      out[d.key] = "hidden";
      continue;
    }
    const states = d.specialties.map((k) => classify(k, roster));
    out[d.key] = states.includes("active") ? "active" : states.includes("coming_soon") ? "coming_soon" : "hidden";
  }
  return out;
});

/**
 * State per homepage tile (HOME_MODALITIES). Most tiles map 1:1 to a specialty
 * key; the curated non-specialty placeholder (veterinarian) carries a
 * `domainKey` and inherits that domain's (master-switch-gated) state.
 */
export const getModalityStates = cache(async (): Promise<Record<string, AvailabilityState>> => {
  const [spec, dom] = await Promise.all([getSpecialtyStates(), getDomainStates()]);
  const out: Record<string, AvailabilityState> = {};
  for (const m of HOME_MODALITIES) {
    out[m.id] = spec[m.id] ?? (m.domainKey ? dom[m.domainKey] : undefined) ?? "hidden";
  }
  return out;
});
