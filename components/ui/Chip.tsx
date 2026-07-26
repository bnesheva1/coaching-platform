"use client";

import type { ReactNode } from "react";

export type ChipProps = {
  children: ReactNode;
  selected?: boolean;
  disabled?: boolean;
  onClick?: () => void;
};

export function Chip({ children, selected = false, disabled = false, onClick }: ChipProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={selected}
      style={{
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
    </button>
  );
}
