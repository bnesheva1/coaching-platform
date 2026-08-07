"use client";

import { useLocale, useTranslations } from "next-intl";
import type { RenameUsage } from "@/lib/rename-limits";

const INTL_LOCALES: Record<string, string> = { bg: "bg-BG", en: "en-US" };

// Shown the moment a name/username field opens for editing — not after a
// failed save. Tells you the limit and how many changes remain in the
// current window; once you're at the limit, it tells you the date you can
// change it again (never a silent failure). For usernames it also notes
// that the old address keeps working.
export function RenameLimitNote({ usage, kind }: { usage: RenameUsage; kind: "name" | "username" }) {
  const t = useTranslations("Profile");
  const locale = useLocale();

  if (usage.remaining <= 0) {
    const date = usage.nextAllowedAt
      ? new Intl.DateTimeFormat(INTL_LOCALES[locale] ?? "en-US", { dateStyle: "long" }).format(new Date(usage.nextAllowedAt))
      : "—";
    return (
      <p
        role="status"
        style={{
          margin: 0,
          padding: "var(--space-2) var(--space-3)",
          borderRadius: "var(--radius-md)",
          background: "var(--accent-subtle)",
          color: "var(--accent-subtle-text)",
          font: "var(--text-body-sm)",
        }}
      >
        {t("renameLimitReached", { date })}
      </p>
    );
  }

  return (
    <p role="status" style={{ margin: 0, font: "var(--text-body-sm)", color: "var(--text-tertiary)" }}>
      {t(kind === "username" ? "usernameChangesRemaining" : "nameChangesRemaining", {
        remaining: usage.remaining,
        days: usage.windowDays,
      })}
    </p>
  );
}
