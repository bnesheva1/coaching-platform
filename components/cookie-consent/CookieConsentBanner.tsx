"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { Button } from "@/components/ui/Button";
import { recordCookieConsent } from "@/app/cookie-consent-actions";

// Rendered once, in the root layout, only when the server-read consent
// cookie was absent (see LocaleLayout) — this component itself never
// re-checks, it just optimistically hides itself the instant either
// button is pressed rather than waiting on the server round trip,
// since there's no validation/error state either button could produce.
export function CookieConsentBanner() {
  const t = useTranslations("CookieConsent");
  const [visible, setVisible] = useState(true);
  const [pending, setPending] = useState(false);

  if (!visible) return null;

  async function choose(analytics: boolean) {
    setPending(true);
    await recordCookieConsent(analytics);
    setVisible(false);
  }

  return (
    <div
      role="region"
      aria-label={t("preferencesTitle")}
      style={{
        position: "fixed",
        left: 0,
        right: 0,
        bottom: 0,
        zIndex: 100,
        background: "var(--bg-surface)",
        borderTop: "1px solid var(--border-subtle)",
        boxShadow: "var(--shadow-md)",
        padding: "var(--space-4) var(--space-6)",
      }}
    >
      <div
        style={{
          maxWidth: 1000,
          margin: "0 auto",
          display: "flex",
          flexWrap: "wrap",
          alignItems: "center",
          gap: "var(--space-4)",
          justifyContent: "space-between",
        }}
      >
        <p style={{ margin: 0, flex: "1 1 400px", font: "var(--text-body-sm)", color: "var(--text-secondary)" }}>
          {t.rich("bannerBody", {
            link: (chunks) => (
              <Link href="/privacy" style={{ color: "var(--accent)" }}>
                {chunks}
              </Link>
            ),
          })}
        </p>
        <div style={{ display: "flex", gap: "var(--space-2)", flexShrink: 0 }}>
          <Button type="button" variant="secondary" size="sm" disabled={pending} onClick={() => choose(false)}>
            {t("essentialOnlyButton")}
          </Button>
          <Button type="button" size="sm" disabled={pending} onClick={() => choose(true)}>
            {t("acceptAllButton")}
          </Button>
        </div>
      </div>
    </div>
  );
}
