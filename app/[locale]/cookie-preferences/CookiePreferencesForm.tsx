"use client";

import { useState } from "react";
import { useTranslations, useFormatter } from "next-intl";
import { Button } from "@/components/ui/Button";
import { recordCookieConsent } from "@/app/cookie-consent-actions";

export function CookiePreferencesForm({
  initialAnalytics,
  updatedAt,
}: {
  initialAnalytics: boolean;
  updatedAt: string | null;
}) {
  const t = useTranslations("CookieConsent");
  const format = useFormatter();
  const [analytics, setAnalytics] = useState(initialAnalytics);
  const [pending, setPending] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(updatedAt);

  async function handleSave() {
    setPending(true);
    await recordCookieConsent(analytics);
    setSavedAt(new Date().toISOString());
    setPending(false);
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-6)" }}>
      <p style={{ margin: 0, font: "var(--text-body-md)", color: "var(--text-secondary)" }}>{t("preferencesIntro")}</p>

      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          gap: "var(--space-4)",
          padding: "var(--space-4)",
          border: "1px solid var(--border-subtle)",
          borderRadius: "var(--radius-lg)",
          background: "var(--bg-surface)",
        }}
      >
        <div>
          <strong>{t("essentialTitle")}</strong>
          <p style={{ margin: "var(--space-1) 0 0", font: "var(--text-body-sm)", color: "var(--text-tertiary)" }}>
            {t("essentialDescription")}
          </p>
        </div>
        <span
          style={{
            font: "var(--text-caption)",
            padding: "2px 10px",
            borderRadius: "var(--radius-pill)",
            background: "var(--bg-sunken)",
            color: "var(--text-tertiary)",
            flexShrink: 0,
          }}
        >
          {t("alwaysOnBadge")}
        </span>
      </div>

      <label
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          gap: "var(--space-4)",
          padding: "var(--space-4)",
          border: "1px solid var(--border-subtle)",
          borderRadius: "var(--radius-lg)",
          background: "var(--bg-surface)",
          cursor: "pointer",
        }}
      >
        <div>
          <strong>{t("analyticsTitle")}</strong>
          <p style={{ margin: "var(--space-1) 0 0", font: "var(--text-body-sm)", color: "var(--text-tertiary)" }}>
            {t("analyticsDescription")}
          </p>
        </div>
        <input
          type="checkbox"
          checked={analytics}
          onChange={(e) => setAnalytics(e.target.checked)}
          style={{ flexShrink: 0, width: 20, height: 20 }}
        />
      </label>

      <div style={{ display: "flex", alignItems: "center", gap: "var(--space-3)" }}>
        <Button type="button" disabled={pending} onClick={handleSave}>
          {t("savePreferencesButton")}
        </Button>
        <span style={{ font: "var(--text-body-sm)", color: "var(--text-tertiary)" }}>
          {savedAt
            ? t("currentChoiceLabel", { date: format.dateTime(new Date(savedAt), { dateStyle: "medium", timeStyle: "short" }) })
            : t("noChoiceYetLabel")}
        </span>
      </div>
    </div>
  );
}
