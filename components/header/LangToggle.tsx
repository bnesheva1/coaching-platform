"use client";

import { usePathname, Link } from "@/i18n/navigation";
import { useLocale } from "next-intl";
import { routing } from "@/i18n/routing";

// The single language control, replacing both the old floating
// LanguageSwitcher (fixed top-right on every page) and the three
// hand-copied inline pills (homepage/client-dashboard/practitioner-
// dashboard). Same pathname-preserving mechanism the old
// LanguageSwitcher used — swap locale, stay on the current page —
// generalized so it works identically wherever NavBar places it (the
// desktop row or the mobile menu).
export function LangToggle() {
  const pathname = usePathname();
  const locale = useLocale();
  const otherLocale = routing.locales.find((l) => l !== locale) ?? locale;
  const labelText = locale === "bg" ? "BG · EN" : "EN · BG";

  return (
    <Link
      href={pathname}
      locale={otherLocale}
      className="focus-ring"
      aria-label={labelText}
      style={{
        display: "inline-block",
        font: "var(--text-label)",
        letterSpacing: "var(--letter-pill)",
        padding: "6px 12px",
        borderRadius: "var(--radius-pill)",
        border: "1px solid var(--border-strong)",
        color: "var(--text-primary)",
        textDecoration: "none",
      }}
    >
      {labelText}
    </Link>
  );
}
