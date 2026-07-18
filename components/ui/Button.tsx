"use client";

import { useState } from "react";
import type { CSSProperties, MouseEventHandler, ReactNode } from "react";
import { Link } from "@/i18n/navigation";

export type ButtonVariant = "primary" | "secondary" | "ghost";
export type ButtonSize = "sm" | "md" | "lg";

type SizeStyle = { padding: string; font: string; radius: string };

const SIZES: Record<ButtonSize, SizeStyle> = {
  sm: { padding: "var(--button-padding-sm)", font: "var(--text-body-sm)", radius: "var(--radius-sm)" },
  md: { padding: "var(--button-padding-md)", font: "600 14px/1.2 var(--font-ui)", radius: "var(--radius-md)" },
  lg: { padding: "var(--button-padding-lg)", font: "600 16px/1.2 var(--font-ui)", radius: "var(--radius-md)" },
};

const VARIANTS: Record<ButtonVariant, CSSProperties> = {
  primary: { background: "var(--accent)", color: "var(--text-on-accent)", border: "1px solid transparent" },
  secondary: { background: "transparent", color: "var(--text-primary)", border: "1px solid var(--border-strong)" },
  ghost: { background: "transparent", color: "var(--text-primary)", border: "1px solid transparent" },
};

const HOVER: Record<ButtonVariant, CSSProperties> = {
  primary: { background: "var(--accent-hover)" },
  secondary: { background: "var(--bg-surface-2)" },
  ghost: { background: "var(--bg-surface-2)" },
};

export type ButtonProps = {
  variant?: ButtonVariant;
  size?: ButtonSize;
  disabled?: boolean;
  children: ReactNode;
  // Mutually exclusive with href — a Button is either a real navigation
  // (Link, locale-aware) or an action (native button with a click
  // handler). Wrapping a <button> in an <a> is invalid markup, so this
  // is a mode switch, not a layering of both.
  onClick?: MouseEventHandler<HTMLButtonElement>;
  type?: "button" | "submit";
  href?: string;
};

export function Button({
  variant = "primary",
  size = "md",
  disabled = false,
  children,
  onClick,
  type = "button",
  href,
}: ButtonProps) {
  const s = SIZES[size];
  const v = VARIANTS[variant];
  const [hover, setHover] = useState(false);

  const style: CSSProperties = {
    fontFamily: "var(--font-ui)",
    font: s.font,
    padding: s.padding,
    borderRadius: s.radius,
    cursor: disabled ? "not-allowed" : "pointer",
    opacity: disabled ? 0.5 : 1,
    transition:
      "background var(--duration-fast) var(--ease-standard), border-color var(--duration-fast) var(--ease-standard)",
    whiteSpace: "nowrap",
    display: "inline-block",
    textDecoration: "none",
    ...v,
    ...(hover && !disabled ? HOVER[variant] : {}),
  };

  const handlers = {
    onMouseEnter: () => setHover(true),
    onMouseLeave: () => setHover(false),
  };

  if (href) {
    return (
      <Link href={href} style={style} {...handlers}>
        {children}
      </Link>
    );
  }

  return (
    <button type={type} disabled={disabled} onClick={onClick} style={style} {...handlers}>
      {children}
    </button>
  );
}
