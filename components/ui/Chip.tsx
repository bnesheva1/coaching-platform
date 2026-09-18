"use client";

import type { ReactNode } from "react";
import { X } from "lucide-react";

export type ChipProps = {
  children: ReactNode;
  selected?: boolean;
  disabled?: boolean;
  // When true AND the chip is selected, an ✕ glyph is shown at the end to
  // signal that clicking removes it (the selection editors — domain/
  // specialties/topics — opt in; single-select highlight chips like the
  // hero's don't, so their click stays a plain re-select).
  removable?: boolean;
  onClick?: () => void;
};

export function Chip({ children, selected = false, disabled = false, removable = false, onClick }: ChipProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={selected}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "6px",
        font: "var(--text-label)",
        fontFamily: "var(--font-ui)",
        padding: "8px 16px",
        borderRadius: "var(--radius-pill)",
        border: `1px solid ${selected ? "var(--accent)" : "var(--border-default)"}`,
        background: selected ? "var(--accent-subtle)" : "var(--bg-surface-2)",
        color: selected ? "var(--accent-subtle-text)" : "var(--text-secondary)",
        cursor: disabled ? "default" : "pointer",
        opacity: disabled ? 0.5 : 1,
        whiteSpace: "nowrap",
        transition: "all var(--duration-fast) var(--ease-standard)",
      }}
    >
      {children}
      {removable && selected && <X size={14} aria-hidden />}
    </button>
  );
}
