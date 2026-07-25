"use client";

import { useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { useIsMobile } from "@/lib/useIsMobile";
import { Button } from "@/components/ui/Button";

export type FilterOption = { key: string; label: string; count: number };

export type BrowseFiltersProps = {
  groupLabel: string;
  options: FilterOption[];
  selected: Set<string>;
  // Desktop: called on every checkbox click (instant-apply — the
  // sidebar sits beside the grid, not over it, so there's no reflow-
  // while-open concern to guard against). Mobile: called once, when the
  // sheet's sticky button is tapped — everything before that is a
  // local draft, per the design source's own reasoning for why mobile
  // needs a confirm step and desktop doesn't.
  onApply: (next: Set<string>) => void;
  onClear: () => void;
  // Lets the sheet's sticky button show a live "Show N results" count
  // for the in-progress draft, without BrowseFilters needing to know
  // anything about practitioner data itself.
  computeCount: (draft: Set<string>) => number;
};

function toggleInSet(set: Set<string>, key: string): Set<string> {
  const next = new Set(set);
  if (next.has(key)) next.delete(key);
  else next.add(key);
  return next;
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
                color: disabled ? "var(--text-tertiary)" : "var(--text-primary)",
                cursor: disabled ? "default" : "pointer",
              }}
            >
              <input
                type="checkbox"
                checked={value.has(option.key)}
                disabled={disabled}
                onChange={() => onToggle(option.key)}
              />
              {option.label} ({option.count})
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

export function BrowseFilters({ groupLabel, options, selected, onApply, onClear, computeCount }: BrowseFiltersProps) {
  const t = useTranslations("Browse");
  const isMobile = useIsMobile();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [draft, setDraft] = useState<Set<string>>(selected);

  // Re-seed the draft from the committed selection each time the sheet
  // opens (e.g. reopening after a previous confirm, or after "Clear"
  // ran elsewhere) — not on every parent render, only on open.
  function openSheet() {
    setDraft(new Set(selected));
    dialogRef.current?.showModal();
  }

  if (!isMobile) {
    return (
      <div style={{ width: "170px", flexShrink: 0 }}>
        <div style={{ marginBottom: "var(--space-4)" }}>
          <span style={{ font: "var(--text-heading-sm)" }}>{t("filtersHeading")}</span>
        </div>
        <OptionList
          groupLabel={groupLabel}
          options={options}
          value={selected}
          onToggle={(key) => onApply(toggleInSet(selected, key))}
        />
        <button
          type="button"
          className="focus-ring"
          onClick={onClear}
          style={{ display: "block", marginTop: "var(--space-4)", background: "none", border: "none", color: "var(--accent)", font: "var(--text-label)", cursor: "pointer", padding: 0 }}
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
          {selected.size > 0 && (
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
                font: "700 var(--text-caption)",
                marginLeft: "var(--space-2)",
                padding: "0 4px",
              }}
            >
              {selected.size}
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
          maxHeight: "80vh",
          background: "var(--bg-surface)",
          color: "var(--text-primary)",
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", maxHeight: "80vh" }}>
          <div
            style={{
              padding: "var(--space-4)",
              borderBottom: "1px solid var(--border-subtle)",
            }}
          >
            <span style={{ font: "var(--text-heading-sm)" }}>{t("filtersHeading")}</span>
          </div>

          <div style={{ padding: "var(--space-4)", overflowY: "auto" }}>
            <OptionList
              groupLabel={groupLabel}
              options={options}
              value={draft}
              onToggle={(key) => setDraft((prev) => toggleInSet(prev, key))}
            />
            <button
              type="button"
              className="focus-ring"
              onClick={() => setDraft(new Set())}
              style={{ display: "block", marginTop: "var(--space-4)", background: "none", border: "none", color: "var(--accent)", font: "var(--text-label)", cursor: "pointer", padding: 0 }}
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
