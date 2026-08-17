"use client";

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useTranslations } from "next-intl";
import { useRouter, usePathname } from "@/i18n/navigation";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { BrowseFilters, type FilterOption, type FilterGroup } from "@/components/browse/BrowseFilters";
import { PractitionerCard } from "@/components/browse/PractitionerCard";
import { useIsMobile } from "@/lib/useIsMobile";

const SEARCH_DEBOUNCE_MS = 300;
// How many cards reveal per scroll batch. Every matching result is
// already held client-side (needed for accurate facet counts across
// the whole set, not just what's currently visible), so "loading" more
// is an instant reveal, not a real fetch — no loading spinner needed.
const PAGE_SIZE = 12;

// Raw shape for this page's own data flow — specialtyKeys/topicKeys (not
// yet mapped to display labels) is what filtering/counting operates on;
// PractitionerCard only ever receives the locale-mapped labels, built
// per-item at render time below.
export type BrowseResult = {
  id: string;
  username: string;
  displayName: string | null;
  bio: string | null;
  avatarUrl: string | null;
  specialtyKeys: string[];
  topicKeys: string[];
  averageRating: number | null;
  reviewCount: number;
  createdAt: string;
  deliveryTypeKeys: string[];
  location: string | null;
  availableNow: boolean;
};

// Simplified for now to just these two — Name/Newest are easy to bring
// back later (the underlying data — displayName, createdAt — is already
// on BrowseResult), just not exposed in the control right now.
type SortBy = "default" | "rating";

const SPECIALTY_GROUP = "specialty";
const TOPIC_GROUP = "topic";
const DELIVERY_TYPE_GROUP = "deliveryType";

// A useState lazy-initializer seed (an earlier version of this) still
// causes a hydration mismatch: the initializer runs once on the SERVER
// and once independently on the CLIENT during hydration, producing two
// different Math.random() values, so the SSR HTML and the client's
// hydration-time render disagree. Same root problem this app already
// solved for browser-timezone detection (TimezoneField.tsx /
// SlotPicker.tsx) — useSyncExternalStore, whose whole purpose is
// exactly this "the server can't know this value" case: it renders
// getServerSnapshot() (deterministic, matches SSR) through hydration,
// then swaps in getSnapshot()'s real client value as an ordinary
// post-mount update, not a hydration diff. The shuffle itself is
// cached per items-array-identity in a WeakMap so getSnapshot keeps
// returning the SAME reference on repeated calls (required by the
// hook) instead of reshuffling on every render.
const shuffleCache = new WeakMap<object, unknown[]>();

function shuffleArray<T>(items: T[]): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function subscribeToNothing() {
  return () => {};
}

function useStableShuffle<T extends object>(items: T[]): T[] {
  function getSnapshot(): T[] {
    let cached = shuffleCache.get(items) as T[] | undefined;
    if (!cached) {
      cached = shuffleArray(items);
      shuffleCache.set(items, cached);
    }
    return cached;
  }
  function getServerSnapshot(): T[] {
    return items;
  }
  return useSyncExternalStore(subscribeToNothing, getSnapshot, getServerSnapshot);
}

function matchesGroup(itemKeys: string[], selected: Set<string>): boolean {
  return selected.size === 0 || itemKeys.some((k) => selected.has(k));
}

export function BrowseClient({
  results,
  query,
  initialSpecialties,
  initialTopics,
  initialDeliveryTypes,
  specialtyOptions,
  topicOptions,
  deliveryTypeOptions,
  saveable,
  viewerIsGuest,
  savedPractitionerIds,
}: {
  results: BrowseResult[];
  query: string;
  initialSpecialties: string[];
  initialTopics: string[];
  initialDeliveryTypes: string[];
  specialtyOptions: { key: string; label: string }[];
  topicOptions: { key: string; label: string }[];
  deliveryTypeOptions: { key: string; label: string }[];
  saveable: boolean;
  viewerIsGuest: boolean;
  savedPractitionerIds: string[];
}) {
  const t = useTranslations("Browse");
  const tImmediate = useTranslations("Immediate");
  const router = useRouter();
  const pathname = usePathname();
  const isMobile = useIsMobile();

  // The „На разположение сега" filter only exists when at least one result is
  // actually available right now (per spec — no dead toggle otherwise). It's a
  // client-side narrow over the already-fetched snapshot, like the other
  // filters; availability staleness across the page's lifetime is acceptable.
  const anyAvailableNow = useMemo(() => results.some((r) => r.availableNow), [results]);
  const [availableOnly, setAvailableOnly] = useState(false);
  // If the last result went unavailable and the toggle vanished, don't let a
  // stuck-on `availableOnly` silently empty the grid.
  const effectiveAvailableOnly = availableOnly && anyAvailableNow;

  // Track saves client-side over the server snapshot so a card that's re-mounted
  // by a filter/sort change still reflects a just-toggled save.
  const [savedSet, setSavedSet] = useState<Set<string>>(() => new Set(savedPractitionerIds));
  const updateSaved = (id: string, saved: boolean) =>
    setSavedSet((prev) => {
      const next = new Set(prev);
      if (saved) next.add(id);
      else next.delete(id);
      return next;
    });

  const [searchText, setSearchText] = useState(query);
  const [selectedModalities, setSelectedModalities] = useState<Set<string>>(new Set(initialSpecialties));
  const [selectedTopics, setSelectedTopics] = useState<Set<string>>(new Set(initialTopics));
  const [selectedDeliveryTypes, setSelectedDeliveryTypes] = useState<Set<string>>(new Set(initialDeliveryTypes));
  // Default is randomized ("default"), not rating — re-sorting to
  // "Рейтинг" is an explicit opt-in. Never refetches or drops the active
  // search/filter state, since it only reorders the already-fetched
  // `filteredResults` below.
  const [sortBy, setSortBy] = useState<SortBy>("default");
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Search text needs a real server round-trip (PGroonga runs in
  // Postgres) — debounced, via a genuine Next.js navigation so the
  // server page component re-fetches and hands down fresh `results`.
  function handleSearchChange(value: string) {
    setSearchText(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      router.replace(
        { pathname, query: buildQuery(value, selectedModalities, selectedTopics, selectedDeliveryTypes) },
        { scroll: false },
      );
    }, SEARCH_DEBOUNCE_MS);
  }

  function buildQuery(q: string, modalities: Set<string>, topics: Set<string>, deliveryTypes: Set<string>) {
    const query: Record<string, string | string[]> = {};
    if (q) query.q = q;
    if (modalities.size > 0) query.specialty = [...modalities];
    if (topics.size > 0) query.topic = [...topics];
    if (deliveryTypes.size > 0) query.deliveryType = [...deliveryTypes];
    return query;
  }

  // Filter changes (any group) are entirely client-derived (see the
  // counts/filter logic below) — no server data is needed, so this
  // updates the visible URL directly via the History API rather than a
  // Next.js navigation, which would otherwise re-run the server
  // component and refetch for no reason on every checkbox click. Still
  // shareable — the URL is correct — just doesn't trigger a round trip.
  function applyFilters(nextModalities: Set<string>, nextTopics: Set<string>, nextDeliveryTypes: Set<string>) {
    setSelectedModalities(nextModalities);
    setSelectedTopics(nextTopics);
    setSelectedDeliveryTypes(nextDeliveryTypes);
    const params = new URLSearchParams();
    const q = buildQuery(searchText, nextModalities, nextTopics, nextDeliveryTypes);
    for (const [key, value] of Object.entries(q)) {
      if (Array.isArray(value)) value.forEach((v) => params.append(key, v));
      else params.set(key, value);
    }
    const qs = params.toString();
    window.history.replaceState(null, "", qs ? `${pathname}?${qs}` : pathname);
  }

  function handleFiltersApply(next: Record<string, Set<string>>) {
    applyFilters(next[SPECIALTY_GROUP] ?? new Set(), next[TOPIC_GROUP] ?? new Set(), next[DELIVERY_TYPE_GROUP] ?? new Set());
  }

  function clearAll() {
    setSearchText("");
    setSelectedModalities(new Set());
    setSelectedTopics(new Set());
    setSelectedDeliveryTypes(new Set());
    if (debounceRef.current) clearTimeout(debounceRef.current);
    router.replace({ pathname }, { scroll: false });
  }

  // Per-option counts within a group are independent of OTHER options in
  // the SAME group (checking a second modality shows what it would ADD,
  // not a count already narrowed by the first) but DO reflect the
  // OTHER group's current selection — e.g. once "Любов" is checked,
  // modality counts show how many love-tagged practitioners each
  // modality has, not the raw unfiltered total. That's what makes
  // combining groups as AND legible instead of just narrowing a list
  // with no explanation.
  const specialtyCounts = useMemo(() => {
    const topicFiltered = results.filter(
      (r) => matchesGroup(r.topicKeys, selectedTopics) && matchesGroup(r.deliveryTypeKeys, selectedDeliveryTypes),
    );
    const map = new Map<string, number>();
    for (const option of specialtyOptions) {
      map.set(option.key, topicFiltered.filter((r) => r.specialtyKeys.includes(option.key)).length);
    }
    return map;
  }, [results, specialtyOptions, selectedTopics, selectedDeliveryTypes]);

  const topicCounts = useMemo(() => {
    const specialtyFiltered = results.filter(
      (r) => matchesGroup(r.specialtyKeys, selectedModalities) && matchesGroup(r.deliveryTypeKeys, selectedDeliveryTypes),
    );
    const map = new Map<string, number>();
    for (const option of topicOptions) {
      map.set(option.key, specialtyFiltered.filter((r) => r.topicKeys.includes(option.key)).length);
    }
    return map;
  }, [results, topicOptions, selectedModalities, selectedDeliveryTypes]);

  const deliveryTypeCounts = useMemo(() => {
    const otherFiltered = results.filter(
      (r) => matchesGroup(r.specialtyKeys, selectedModalities) && matchesGroup(r.topicKeys, selectedTopics),
    );
    const map = new Map<string, number>();
    for (const option of deliveryTypeOptions) {
      map.set(option.key, otherFiltered.filter((r) => r.deliveryTypeKeys.includes(option.key)).length);
    }
    return map;
  }, [results, deliveryTypeOptions, selectedModalities, selectedTopics]);

  const specialtyFilterOptions: FilterOption[] = specialtyOptions.map((o) => ({
    key: o.key,
    label: o.label,
    count: specialtyCounts.get(o.key) ?? 0,
  }));
  const topicFilterOptions: FilterOption[] = topicOptions.map((o) => ({
    key: o.key,
    label: o.label,
    count: topicCounts.get(o.key) ?? 0,
  }));
  const deliveryTypeFilterOptions: FilterOption[] = deliveryTypeOptions.map((o) => ({
    key: o.key,
    label: o.label,
    count: deliveryTypeCounts.get(o.key) ?? 0,
  }));

  const filterGroups: FilterGroup[] = [
    { key: SPECIALTY_GROUP, groupLabel: t("modalityGroupLabel"), options: specialtyFilterOptions, selected: selectedModalities },
    { key: TOPIC_GROUP, groupLabel: t("topicGroupLabel"), options: topicFilterOptions, selected: selectedTopics },
    { key: DELIVERY_TYPE_GROUP, groupLabel: t("deliveryTypeGroupLabel"), options: deliveryTypeFilterOptions, selected: selectedDeliveryTypes },
  ];

  function computeCountFor(draft: Record<string, Set<string>>): number {
    const modalities = draft[SPECIALTY_GROUP] ?? new Set<string>();
    const topics = draft[TOPIC_GROUP] ?? new Set<string>();
    const deliveryTypes = draft[DELIVERY_TYPE_GROUP] ?? new Set<string>();
    return results.filter(
      (r) => matchesGroup(r.specialtyKeys, modalities) && matchesGroup(r.topicKeys, topics) && matchesGroup(r.deliveryTypeKeys, deliveryTypes),
    ).length;
  }

  const filteredResults = useMemo(
    () =>
      results.filter(
        (r) =>
          matchesGroup(r.specialtyKeys, selectedModalities) &&
          matchesGroup(r.topicKeys, selectedTopics) &&
          matchesGroup(r.deliveryTypeKeys, selectedDeliveryTypes) &&
          (!effectiveAvailableOnly || r.availableNow),
      ),
    [results, selectedModalities, selectedTopics, selectedDeliveryTypes, effectiveAvailableOnly],
  );

  // Ordering: "default" is the stable-per-fetch shuffle (fair rotation
  // across visits, same as the original pre-sort-control behavior) —
  // "Рейтинг" is an explicit opt-in that sorts highest-first, keeping
  // unrated practitioners in that same shuffle among themselves rather
  // than a fixed tie order, so having no reviews yet doesn't bury
  // someone in a fixed, unchanging last position.
  const shuffled = useStableShuffle(filteredResults);
  const orderedResults = useMemo(() => {
    if (sortBy === "rating") {
      const rated = filteredResults.filter((r) => r.averageRating !== null);
      const unrated = shuffled.filter((r) => r.averageRating === null);
      return [...rated.sort((a, b) => (b.averageRating ?? 0) - (a.averageRating ?? 0)), ...unrated];
    }
    // Default sort: available-now practitioners float to the top (placement, not
    // a badge), preserving the stable shuffle order within each partition — so
    // there's no fixed tie order among the available, just a fair rotation.
    const available = shuffled.filter((r) => r.availableNow);
    const rest = shuffled.filter((r) => !r.availableNow);
    return [...available, ...rest];
  }, [filteredResults, shuffled, sortBy]);

  const specialtyLabelByKey = new Map(specialtyOptions.map((o) => [o.key, o.label]));
  const topicLabelByKey = new Map(topicOptions.map((o) => [o.key, o.label]));
  const deliveryTypeLabelByKey = new Map(deliveryTypeOptions.map((o) => [o.key, o.label]));

  // Continuous-scroll reveal over the already-fetched result set — how
  // many of `orderedResults` are actually rendered right now.
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  // Reset to one page whenever the underlying filtered set changes (a
  // new search or a different filter selection) — adjusted during
  // render via a prevValue comparison, not a useEffect+setState, same
  // pattern this app already uses for "state that should reset when an
  // upstream value changes" (see EditableAbout.tsx and others) — this
  // avoids the extra render/effect round trip for a plain derived reset.
  const [prevFilteredResults, setPrevFilteredResults] = useState(filteredResults);
  if (filteredResults !== prevFilteredResults) {
    setPrevFilteredResults(filteredResults);
    setVisibleCount(PAGE_SIZE);
  }

  const visibleResults = orderedResults.slice(0, visibleCount);
  const hasMore = visibleCount < orderedResults.length;

  // The scroll-triggered growth itself, unlike the reset above, is a
  // genuine subscription to an external system (the viewport
  // intersecting a sentinel element) — exactly what useEffect is for;
  // setVisibleCount here runs from the observer's own async callback,
  // not synchronously in the effect body.
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || !hasMore) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          setVisibleCount((c) => Math.min(c + PAGE_SIZE, orderedResults.length));
        }
      },
      { rootMargin: "400px" },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [hasMore, orderedResults.length]);

  // Active-filter chips span all three groups — a plain [key, label,
  // group] list so removing one only has to touch its own group's Set.
  const activeChips = [
    ...[...selectedModalities].map((key) => ({ group: SPECIALTY_GROUP, key, label: specialtyLabelByKey.get(key) ?? key })),
    ...[...selectedTopics].map((key) => ({ group: TOPIC_GROUP, key, label: topicLabelByKey.get(key) ?? key })),
    ...[...selectedDeliveryTypes].map((key) => ({ group: DELIVERY_TYPE_GROUP, key, label: deliveryTypeLabelByKey.get(key) ?? key })),
  ];

  return (
    <>
      {/* Page title is lighter/larger than the (now-bolder, smaller)
          --text-heading-lg role — it's an exact match for the unchanged
          --text-display-sm token (400 26px), not a new one. */}
      <h1 style={{ font: "var(--text-display-sm)", color: "var(--text-primary)", margin: "0 0 var(--space-4)" }}>{t("title")}</h1>

      <div style={{ marginBottom: "var(--space-4)", position: "relative" }}>
        {/* Decorative only — the input already carries its accessible
            name via aria-label below, and search runs live on keystroke
            with no separate submit action for this glyph to represent. */}
        <span
          aria-hidden="true"
          style={{
            position: "absolute",
            right: "var(--space-3)",
            top: "50%",
            transform: "translateY(-50%)",
            font: "var(--text-icon)",
            color: "var(--text-tertiary)",
            pointerEvents: "none",
          }}
        >
          ⌕
        </span>
        <input
          type="text"
          value={searchText}
          onChange={(e) => handleSearchChange(e.target.value)}
          placeholder={t("searchPlaceholder")}
          aria-label={t("searchAriaLabel")}
          className="form-field"
          style={{
            width: "100%",
            paddingRight: "calc(var(--space-3) * 2 + 1em)",
            // Card 2a spec asks for --radius-lg (not .form-field's own
            // --radius-md default) plus a very subtle lift — page-
            // specific overrides on this one field, not a change to the
            // shared .form-field recipe every input in the app uses.
            borderRadius: "var(--radius-lg)",
            boxShadow: "0 1px 2px hsl(var(--shadow-color) / .03)",
          }}
        />
      </div>

      {/* Row on desktop (190px filter sidebar beside the results grid) —
          BrowseFilters instead renders as a compact "Filters" button on
          mobile (its own isMobile branch, opening a bottom sheet), so
          without this the two still sat side by side there too,
          squeezing the results grid into a narrow leftover column
          rather than stacking full-width beneath the button. */}
      <div style={{ display: "flex", flexDirection: isMobile ? "column" : "row", gap: "var(--space-6)", alignItems: isMobile ? "stretch" : "flex-start" }}>
        <BrowseFilters
          groups={filterGroups}
          onApply={handleFiltersApply}
          onClear={clearAll}
          computeCount={computeCountFor}
        />

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "var(--space-3)", marginBottom: "var(--space-4)" }}>
            <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: "var(--space-2)" }}>
              {anyAvailableNow && (
                <button
                  type="button"
                  className="focus-ring"
                  aria-pressed={effectiveAvailableOnly}
                  onClick={() => setAvailableOnly((v) => !v)}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "var(--space-1)",
                    background: effectiveAvailableOnly ? "var(--accent)" : "var(--bg-surface)",
                    color: effectiveAvailableOnly ? "var(--text-on-accent)" : "var(--text-secondary)",
                    border: `1px solid ${effectiveAvailableOnly ? "var(--accent)" : "var(--border-default)"}`,
                    font: "var(--text-caption)",
                    fontWeight: 600,
                    padding: "4px var(--space-2)",
                    borderRadius: "var(--radius-pill)",
                    cursor: "pointer",
                    touchAction: "manipulation",
                  }}
                >
                  <span
                    aria-hidden="true"
                    style={{
                      width: 7,
                      height: 7,
                      borderRadius: "50%",
                      background: effectiveAvailableOnly ? "var(--text-on-accent)" : "var(--accent)",
                    }}
                  />
                  {tImmediate("availableNowLabel")}
                </button>
              )}
              {activeChips.map(({ group, key, label }) => (
                // The whole pill is the button now, not just the ✕ —
                // a bigger, more reliable tap target (and simpler than
                // a button nested in a separately-styled wrapper). The
                // ✕ stays as plain decorative text inside it.
                <button
                  key={`${group}:${key}`}
                  type="button"
                  className="focus-ring"
                  aria-label={label}
                  onClick={() => {
                    if (group === SPECIALTY_GROUP) {
                      const next = new Set(selectedModalities);
                      next.delete(key);
                      applyFilters(next, selectedTopics, selectedDeliveryTypes);
                    } else if (group === TOPIC_GROUP) {
                      const next = new Set(selectedTopics);
                      next.delete(key);
                      applyFilters(selectedModalities, next, selectedDeliveryTypes);
                    } else {
                      const next = new Set(selectedDeliveryTypes);
                      next.delete(key);
                      applyFilters(selectedModalities, selectedTopics, next);
                    }
                  }}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "var(--space-1)",
                    background: "var(--accent-subtle)",
                    color: "var(--accent-subtle-text)",
                    font: "var(--text-caption)",
                    fontWeight: 600,
                    padding: "4px var(--space-2)",
                    borderRadius: "var(--radius-pill)",
                    border: "none",
                    cursor: "pointer",
                    // Same fix as the mobile filter sheet's checkbox
                    // rows (BrowseFilters.tsx) — without this, mobile
                    // browsers spend the first tap on a small target
                    // like this deciding whether it's a tap or the
                    // start of a scroll (this whole row can scroll
                    // horizontally-ish as chips wrap), swallowing it;
                    // manipulation lets the browser commit immediately.
                    touchAction: "manipulation",
                  }}
                >
                  {label}
                  <span aria-hidden="true" style={{ opacity: 0.7 }}>
                    ✕
                  </span>
                </button>
              ))}
              <span style={{ font: "var(--text-body-xs)", color: "var(--text-tertiary)" }}>
                {t("resultsCount", { count: orderedResults.length })}
              </span>
            </div>

            <label style={{ display: "flex", alignItems: "center", gap: "var(--space-2)", font: "var(--text-body-xs)", color: "var(--text-secondary)" }}>
              {t("sortLabel")}
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as SortBy)}
                className="focus-ring"
                style={{
                  background: "var(--bg-surface)",
                  border: "1px solid var(--border-default)",
                  borderRadius: "var(--radius-md)",
                  padding: "var(--space-2) var(--space-3)",
                  font: "var(--text-caption)",
                  fontWeight: 600,
                  color: "var(--text-primary)",
                }}
              >
                <option value="default">{t("sortDefault")}</option>
                <option value="rating">{t("sortRating")}</option>
              </select>
            </label>
          </div>

          {orderedResults.length === 0 ? (
            <Card
              title={query.trim() ? t("emptyStateTitleWithQuery", { query }) : t("emptyStateTitleNoQuery")}
              description={t("emptyStateBody")}
              footer={
                <Button type="button" onClick={clearAll}>
                  {t("emptyStateCta")}
                </Button>
              }
            />
          ) : (
            <>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))",
                  gap: "var(--space-4)",
                  alignContent: "start",
                }}
              >
                {visibleResults.map((practitioner) => (
                  <PractitionerCard
                    key={practitioner.id}
                    practitioner={{
                      id: practitioner.id,
                      username: practitioner.username,
                      displayName: practitioner.displayName,
                      bio: practitioner.bio,
                      avatarUrl: practitioner.avatarUrl,
                      averageRating: practitioner.averageRating,
                      reviewCount: practitioner.reviewCount,
                      specialtyLabels: practitioner.specialtyKeys.map((key) => specialtyLabelByKey.get(key) ?? key),
                      topicLabels: practitioner.topicKeys.map((key) => topicLabelByKey.get(key) ?? key),
                      deliveryTypeLabels: practitioner.deliveryTypeKeys.map((key) => deliveryTypeLabelByKey.get(key) ?? key),
                      location: practitioner.location,
                      availableNow: practitioner.availableNow,
                    }}
                    saveable={saveable}
                    saved={savedSet.has(practitioner.id)}
                    viewerIsGuest={viewerIsGuest}
                    onToggleSave={(s) => updateSaved(practitioner.id, s)}
                  />
                ))}
              </div>
              {/* rootMargin on the observer above triggers this ~400px
                  before it's actually scrolled into view, so more cards
                  are already rendered by the time the seeker reaches the
                  bottom — a continuous-feeling scroll, not a visible
                  "loading" jump. Renders nothing (no spinner) once
                  hasMore is false, rather than lingering as dead space. */}
              {hasMore && <div ref={sentinelRef} aria-hidden="true" style={{ height: 1 }} />}
            </>
          )}
        </div>
      </div>
    </>
  );
}
