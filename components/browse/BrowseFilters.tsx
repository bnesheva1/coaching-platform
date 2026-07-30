"use client";

import { useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { useIsMobile } from "@/lib/useIsMobile";
import { Button } from "@/components/ui/Button";

export type FilterOption = { key: string; label: string; count: number };

// One group per independent taxonomy (modality, topics, ...) — options
// within a group combine as OR, groups combine with each other as AND
// (checking "Таро" and "Любов" means tarot-OR-astrology-etc. among
// selected modalities, AND love-OR-etc. among selected topics).
export type FilterGroup = {
  key: string;
  groupLabel: string;
  options: FilterOption[];
  selected: Set<string>;
};

export type BrowseFiltersProps = {
  groups: FilterGroup[];
  // Desktop: called with the full next state (every group, not just the
  // one that changed) on every checkbox click — instant-apply, since the
  // sidebar sits beside the grid, not over it. Mobile: called once, when
  // the sheet's sticky button is tapped — everything before that is a
  // local draft, per the design source's own reasoning for why mobile
  // needs a confirm step and desktop doesn't.
  onApply: (next: Record<string, Set<string>>) => void;
  onClear: () => void;
  // Lets the sheet's sticky button show a live "Show N results" count
  // for the in-progress draft, without BrowseFilters needing to know
  // anything about practitioner data itself.
  computeCount: (draft: Record<string, Set<string>>) => number;
};

function toggleInSet(set: Set<string>, key: string): Set<string> {
  const next = new Set(set);
  if (next.has(key)) next.delete(key);
  else next.add(key);
  return next;
}

function groupsToMap(groups: FilterGroup[]): Record<string, Set<string>> {
  return Object.fromEntries(groups.map((g) => [g.key, g.selected]));
}

function totalSelected(map: Record<string, Set<string>>): number {
  return Object.values(map).reduce((sum, set) => sum + set.size, 0);
}

function OptionList({
  groupLabel,
  options,
  value,
  onToggle,
}: {
  groupLabel: string;
  options: FilterOption[];
  value: Set<string>;
  onToggle: (key: string) => void;
}) {
  return (
    <fieldset style={{ border: "none", padding: 0, margin: 0 }}>
      <legend style={{ padding: 0, font: "var(--text-label)", color: "var(--text-primary)", marginBottom: "var(--space-2)" }}>
        {groupLabel}
      </legend>
      <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
        {options.map((option) => {
          // Zero-count rows stay visible rather than disappearing — a
          // seeker should still see the full taxonomy even when nothing
          // currently matches it, per the design source's own note.
          const disabled = option.count === 0;
          return (
            <label
              key={option.key}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "var(--space-2)",
                font: "var(--text-body-xs)",
                color: disabled ? "var(--text-tertiary)" : "var(--text-primary)",
                cursor: disabled ? "default" : "pointer",
                // Without this, mobile browsers can spend the first tap
                // on a row inside the scrollable sheet below deciding
                // whether it's a tap or the start of a scroll (any tiny
                // finger movement reads as "maybe scrolling") — the tap
                // gets swallowed, the checkbox doesn't toggle, and only
                // a second, now-unambiguous tap actually registers.
                // manipulation tells the browser this row is only ever
                // panned/tapped, never pinch-zoomed, so it can commit to
                // the tap immediately instead of waiting.
                touchAction: "manipulation",
              }}
            >
              <input
                type="checkbox"
                checked={value.has(option.key)}
                disabled={disabled}
                onChange={() => onToggle(option.key)}
                style={{ width: 14, height: 14, accentColor: "var(--accent)", touchAction: "manipulation" }}
              />
              {option.label} ({option.count})
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

export function BrowseFilters({ groups, onApply, onClear, computeCount }: BrowseFiltersProps) {
  const t = useTranslations("Browse");
  const isMobile = useIsMobile();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [draft, setDraft] = useState<Record<string, Set<string>>>(groupsToMap(groups));

  // Re-seed the draft from the committed selection each time the sheet
  // opens (e.g. reopening after a previous confirm, or after "Clear"
  // ran elsewhere) — not on every parent render, only on open.
  function openSheet() {
    setDraft(groupsToMap(groups));
    dialogRef.current?.showModal();
  }

  const committedMap = groupsToMap(groups);
  const committedCount = totalSelected(committedMap);

  if (!isMobile) {
    return (
      // Card 2a handoff: a bounded panel (surface-2 fill, its own
      // radius/shadow), not bare checkboxes in empty space — width 190px
      // (was 170px), padding rounds 18px→--space-5 (2px over, not worth
      // its own token), gap rounds 14px→--space-4. The "Изчисти
      // филтрите" link stays at the BOTTOM of the list rather than
      // moving back into the header next to "Филтри" the way the
      // reference shows it — that bottom placement and the fuller
      // wording were both explicit asks earlier in this project, and the
      // handoff doesn't call out overriding them, so the prior decision
      // wins over the mockup's incidental default layout.
      <div
        style={{
          width: "190px",
          flexShrink: 0,
          background: "var(--bg-surface-2)",
          borderRadius: "var(--radius-xl)",
          padding: "var(--space-5)",
          boxShadow: "0 1px 2px hsl(var(--shadow-color) / .04)",
          display: "flex",
          flexDirection: "column",
          gap: "var(--space-5)",
        }}
      >
        <span style={{ font: "var(--text-label)", fontWeight: 700, color: "var(--text-primary)" }}>{t("filtersHeading")}</span>
        {groups.map((group) => (
          <OptionList
            key={group.key}
            groupLabel={group.groupLabel}
            options={group.options}
            value={group.selected}
            onToggle={(key) => onApply({ ...committedMap, [group.key]: toggleInSet(group.selected, key) })}
          />
        ))}
        <button
          type="button"
          className="focus-ring"
          onClick={onClear}
          style={{ display: "block", background: "none", border: "none", color: "var(--accent)", font: "var(--text-label)", cursor: "pointer", padding: 0, textAlign: "left" }}
        >
          {t("clearFilters")}
        </button>
      </div>
    );
  }

  return (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)", marginBottom: "var(--space-4)" }}>
        <Button type="button" variant="secondary" size="sm" onClick={openSheet}>
          {t("filtersHeading")}
          {committedCount > 0 && (
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                minWidth: 18,
                height: 18,
                borderRadius: "50%",
                background: "var(--accent)",
                color: "var(--text-on-accent)",
                font: "var(--text-caption)",
                fontWeight: 700,
                marginLeft: "var(--space-2)",
                padding: "0 4px",
              }}
            >
              {committedCount}
            </span>
          )}
        </Button>
      </div>

      <dialog
        ref={dialogRef}
        onClick={(e) => {
          if (e.target === dialogRef.current) dialogRef.current?.close();
        }}
        style={{
          border: "none",
          borderRadius: "18px 18px 0 0",
          padding: 0,
          margin: "auto 0 0",
          width: "100%",
          maxWidth: "100%",
          // dvh, not vh — vh is pinned to the browser's LARGEST possible
          // viewport (as if the address bar were already hidden), but
          // iOS Safari renders with it visible, then auto-collapses it
          // on the first touch interaction. That collapse grows the
          // real viewport out from under an 80vh sheet, so everything
          // inside visibly jumps mid-tap and swallows the touch instead
          // of registering it as a click. dvh tracks the actual current
          // viewport instead of the toolbar-hidden maximum, so nothing
          // resizes out from under the tap.
          maxHeight: "80dvh",
          background: "var(--bg-surface)",
          color: "var(--text-primary)",
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", maxHeight: "80dvh" }}>
          <div
            style={{
              padding: "var(--space-4)",
              borderBottom: "1px solid var(--border-subtle)",
            }}
          >
            <span style={{ font: "var(--text-heading-sm)" }}>{t("filtersHeading")}</span>
          </div>

          {/* pan-y (not the default auto/none) — tells mobile browsers
              this area only ever scrolls vertically, so a tap on a row
              inside it can commit immediately instead of first waiting
              to see if the touch turns into a scroll (see the identical
              touchAction note on each checkbox row below — same root
              cause, the container-level half of the same fix). */}
          <div style={{ padding: "var(--space-4)", overflowY: "auto", touchAction: "pan-y", display: "flex", flexDirection: "column", gap: "var(--space-5)" }}>
            {groups.map((group) => (
              <OptionList
                key={group.key}
                groupLabel={group.groupLabel}
                options={group.options}
                value={draft[group.key] ?? new Set()}
                onToggle={(key) =>
                  setDraft((prev) => ({ ...prev, [group.key]: toggleInSet(prev[group.key] ?? new Set(), key) }))
                }
              />
            ))}
            <button
              type="button"
              className="focus-ring"
              onClick={() => setDraft(Object.fromEntries(groups.map((g) => [g.key, new Set<string>()])))}
              style={{ display: "block", background: "none", border: "none", color: "var(--accent)", font: "var(--text-label)", cursor: "pointer", padding: 0, textAlign: "left" }}
            >
              {t("clearFilters")}
            </button>
          </div>

          <div style={{ padding: "var(--space-4)", borderTop: "1px solid var(--border-subtle)" }}>
            {/* Not the shared <Button> here — it needs to fill the
                sheet's width and Button.tsx has no style-override prop.
                Same primary-variant recipe (--accent/--text-on-accent),
                just full-width. */}
            <button
              type="button"
              className="focus-ring"
              onClick={() => {
                onApply(draft);
                dialogRef.current?.close();
              }}
              style={{
                width: "100%",
                background: "var(--accent)",
                color: "var(--text-on-accent)",
                border: "1px solid transparent",
                borderRadius: "var(--radius-md)",
                padding: "var(--button-padding-md)",
                font: "var(--text-button-md)",
                fontFamily: "var(--font-ui)",
                cursor: "pointer",
              }}
            >
              {t("showResultsButton", { count: computeCount(draft) })}
            </button>
          </div>
        </div>
      </dialog>
    </>
  );
}
