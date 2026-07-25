"use client";

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useTranslations } from "next-intl";
import { useRouter, usePathname } from "@/i18n/navigation";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { BrowseFilters, type FilterOption } from "@/components/browse/BrowseFilters";
import { PractitionerCard } from "@/components/browse/PractitionerCard";

const SEARCH_DEBOUNCE_MS = 300;
// How many cards reveal per scroll batch. Every matching result is
// already held client-side (needed for accurate facet counts across
// the whole set, not just what's currently visible), so "loading" more
// is an instant reveal, not a real fetch — no loading spinner needed.
const PAGE_SIZE = 12;

// Raw shape for this page's own data flow — specialtyKeys (not yet
// mapped to display labels) is what filtering/counting operates on;
// PractitionerCard only ever receives the locale-mapped labels, built
// per-item at render time below.
export type BrowseResult = {
  id: string;
  username: string;
  displayName: string | null;
  bio: string | null;
  avatarUrl: string | null;
  specialtyKeys: string[];
  averageRating: number | null;
  reviewCount: number;
};

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

export function BrowseClient({
  results,
  query,
  initialSpecialties,
  specialtyOptions,
}: {
  results: BrowseResult[];
  query: string;
  initialSpecialties: string[];
  specialtyOptions: { key: string; label: string }[];
}) {
  const t = useTranslations("Browse");
  const router = useRouter();
  const pathname = usePathname();

  const [searchText, setSearchText] = useState(query);
  const [selectedModalities, setSelectedModalities] = useState<Set<string>>(new Set(initialSpecialties));
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Search text needs a real server round-trip (PGroonga runs in
  // Postgres) — debounced, via a genuine Next.js navigation so the
  // server page component re-fetches and hands down fresh `results`.
  function handleSearchChange(value: string) {
    setSearchText(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      router.replace(
        { pathname, query: buildQuery(value, selectedModalities) },
        { scroll: false },
      );
    }, SEARCH_DEBOUNCE_MS);
  }

  function buildQuery(q: string, modalities: Set<string>) {
    const query: Record<string, string | string[]> = {};
    if (q) query.q = q;
    if (modalities.size > 0) query.specialty = [...modalities];
    return query;
  }

  // Modality changes are entirely client-derived (see the counts/filter
  // logic below) — no server data is needed, so this updates the
  // visible URL directly via the History API rather than a Next.js
  // navigation, which would otherwise re-run the server component and
  // refetch for no reason on every checkbox click. Still shareable —
  // the URL is correct — just doesn't trigger a round trip.
  function applyModalities(next: Set<string>) {
    setSelectedModalities(next);
    const params = new URLSearchParams();
    const q = buildQuery(searchText, next);
    for (const [key, value] of Object.entries(q)) {
      if (Array.isArray(value)) value.forEach((v) => params.append(key, v));
      else params.set(key, value);
    }
    const qs = params.toString();
    window.history.replaceState(null, "", qs ? `${pathname}?${qs}` : pathname);
  }

  function clearAll() {
    setSearchText("");
    setSelectedModalities(new Set());
    if (debounceRef.current) clearTimeout(debounceRef.current);
    router.replace({ pathname }, { scroll: false });
  }

  // Per-option counts reflect the search-filtered candidate set
  // (`results`, as fetched — specialty_keys is never sent to the RPC
  // now, see page.tsx) independent of which OTHER modality boxes are
  // currently checked, since options within this one group combine as
  // OR: checking a second option should show what it would ADD, not a
  // count already narrowed by the first.
  const counts = useMemo(() => {
    const map = new Map<string, number>();
    for (const option of specialtyOptions) {
      map.set(option.key, results.filter((r) => r.specialtyKeys.includes(option.key)).length);
    }
    return map;
  }, [results, specialtyOptions]);

  const options: FilterOption[] = specialtyOptions.map((o) => ({
    key: o.key,
    label: o.label,
    count: counts.get(o.key) ?? 0,
  }));

  function computeCountFor(modalities: Set<string>): number {
    if (modalities.size === 0) return results.length;
    return results.filter((r) => r.specialtyKeys.some((k) => modalities.has(k))).length;
  }

  const filteredResults = useMemo(
    () =>
      selectedModalities.size === 0
        ? results
        : results.filter((r) => r.specialtyKeys.some((k) => selectedModalities.has(k))),
    [results, selectedModalities],
  );

  // Ordering: a real search query already comes back relevance-ordered
  // from the RPC (pgroonga score) and filtering by modality client-side
  // preserves that relative order. With no query: alphabetical once a
  // filter is active (predictable, not arbitrary, once the seeker has
  // taken a narrowing action), otherwise a stable-per-fetch shuffle —
  // "rotating" across visits without reshuffling mid-session.
  const shuffled = useStableShuffle(filteredResults);
  const orderedResults =
    query.trim() !== ""
      ? filteredResults
      : selectedModalities.size > 0
        ? [...filteredResults].sort((a, b) => (a.displayName || a.username).localeCompare(b.displayName || b.username))
        : shuffled;

  const specialtyLabelByKey = new Map(specialtyOptions.map((o) => [o.key, o.label]));

  // Continuous-scroll reveal over the already-fetched result set — how
  // many of `orderedResults` are actually rendered right now.
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  // Reset to one page whenever the underlying filtered set changes (a
  // new search or a different modality selection) — adjusted during
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

  return (
    <>
      <h1 style={{ font: "var(--text-heading-lg)", margin: "0 0 var(--space-4)" }}>{t("title")}</h1>

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
          style={{ width: "100%", paddingRight: "calc(var(--space-3) * 2 + 1em)" }}
        />
      </div>

      <div style={{ display: "flex", gap: "var(--space-6)", alignItems: "flex-start" }}>
        <BrowseFilters
          groupLabel={t("modalityGroupLabel")}
          options={options}
          selected={selectedModalities}
          onApply={applyModalities}
          onClear={clearAll}
          computeCount={computeCountFor}
        />

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: "var(--space-2)", marginBottom: "var(--space-4)" }}>
            {[...selectedModalities].map((key) => (
              <span
                key={key}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "var(--space-1)",
                  background: "var(--accent-subtle)",
                  color: "var(--accent-subtle-text)",
                  font: "600 var(--text-caption)",
                  padding: "4px var(--space-2)",
                  borderRadius: "var(--radius-pill)",
                }}
              >
                {specialtyLabelByKey.get(key) ?? key}
                <button
                  type="button"
                  className="focus-ring"
                  aria-label={specialtyLabelByKey.get(key) ?? key}
                  onClick={() => {
                    const next = new Set(selectedModalities);
                    next.delete(key);
                    applyModalities(next);
                  }}
                  style={{ background: "none", border: "none", color: "inherit", cursor: "pointer", padding: 0, font: "inherit", opacity: 0.7 }}
                >
                  ✕
                </button>
              </span>
            ))}
            <span style={{ font: "var(--text-body-sm)", color: "var(--text-tertiary)" }}>
              {t("resultsCount", { count: orderedResults.length })}
            </span>
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
                    }}
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
