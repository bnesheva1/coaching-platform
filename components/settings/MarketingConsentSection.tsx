"use client";

import { useState } from "react";
import { useTranslations, useFormatter } from "next-intl";
import { Button } from "@/components/ui/Button";
import { updateMarketingConsent } from "@/app/account-actions";

// Separate, explicit, unticked-by-default — this is never pre-checked
// server-side either (see the migration: marketing_consent defaults to
// false), so "not yet saved" and "explicitly declined" both render the
// same unchecked state, which is the correct default for an opt-in.
export function MarketingConsentSection({
  initialConsent,
  updatedAt,
}: {
  initialConsent: boolean;
  updatedAt: string | null;
}) {
  const t = useTranslations("AccountSettings");
  const format = useFormatter();
  const [consent, setConsent] = useState(initialConsent);
  const [pending, setPending] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(updatedAt);

  async function handleSave() {
    setPending(true);
    const result = await updateMarketingConsent(consent);
    if (result.success) setSavedAt(new Date().toISOString());
    setPending(false);
  }

  return (
    <section
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "var(--space-3)",
        padding: "var(--space-4)",
        border: "1px solid var(--border-subtle)",
        borderRadius: "var(--radius-lg)",
        background: "var(--bg-surface)",
      }}
    >
      <div>
        <h2 style={{ margin: 0, font: "var(--text-heading-sm)" }}>{t("marketingConsentTitle")}</h2>
        <p style={{ margin: "var(--space-1) 0 0", font: "var(--text-body-sm)", color: "var(--text-tertiary)" }}>
          {t("marketingConsentDescription")}
        </p>
      </div>
      <label style={{ display: "flex", alignItems: "center", gap: "var(--space-2)", cursor: "pointer" }}>
        <input
          type="checkbox"
          checked={consent}
          onChange={(e) => setConsent(e.target.checked)}
          style={{ width: 20, height: 20 }}
        />
        {t("marketingConsentCheckboxLabel")}
      </label>
      <div style={{ display: "flex", alignItems: "center", gap: "var(--space-3)" }}>
        <Button type="button" size="sm" disabled={pending} onClick={handleSave}>
          {t("marketingConsentSaveButton")}
        </Button>
        <span style={{ font: "var(--text-body-sm)", color: "var(--text-tertiary)" }}>
          {savedAt
            ? t("marketingConsentSavedLabel", {
                date: format.dateTime(new Date(savedAt), { dateStyle: "medium", timeStyle: "short" }),
              })
            : t("marketingConsentNotSetLabel")}
        </span>
      </div>
    </section>
  );
}
