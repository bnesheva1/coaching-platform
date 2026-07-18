"use client";

import { usePathname, Link } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";

const LOCALE_LABELS: Record<string, string> = {
  bg: "BG",
  en: "EN",
};

export function LanguageSwitcher() {
  const pathname = usePathname();

  // The homepage has its own working language toggle built into its
  // NavBar now — this floating switcher would otherwise duplicate it.
  // Every other (still-unstyled) page keeps this as its only language
  // control.
  if (pathname === "/") {
    return null;
  }

  return (
    <p style={{ fontSize: "0.85rem", fontFamily: "sans-serif" }}>
      {routing.locales.map((locale, i) => (
        <span key={locale}>
          {i > 0 && " | "}
          <Link href={pathname} locale={locale}>
            {LOCALE_LABELS[locale] ?? locale}
          </Link>
        </span>
      ))}
    </p>
  );
}
