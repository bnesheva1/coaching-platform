import { getTranslations } from "next-intl/server";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { startStripeConnectOnboarding } from "@/app/[locale]/practitioner-dashboard/connect-actions";

// No "use client" — a plain <form action={...}> submitting straight to
// the Server Action is all this needs (unlike ProfileSettingsBox, there
// is no live client-side state here: no interactivity worth hydrating
// for, just a status readout and a submit button that always ends in a
// full-page external redirect to Stripe). getTranslations (async, from
// next-intl/server), not useTranslations — that's the client-only hook,
// see ProfileSettingsBox.tsx's own "use client" for the contrast.
export async function StripeConnectSection({
  isConnected,
  transfersActive,
  errorCode,
}: {
  isConnected: boolean;
  transfersActive: boolean;
  errorCode: string | null;
}) {
  const t = await getTranslations("StripeConnect");

  const isActive = isConnected && transfersActive;
  const status = !isConnected ? "notConnected" : isActive ? "active" : "incomplete";

  const badgeStyle = {
    font: "var(--text-caption)",
    padding: "2px 10px",
    borderRadius: "var(--radius-pill)",
    background: isActive ? "var(--accent-subtle)" : "var(--bg-sunken)",
    color: isActive ? "var(--accent-subtle-text)" : "var(--text-tertiary)",
  } as const;

  return (
    <Card
      title={t("title")}
      description={t(`description.${status}`)}
      footer={
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
          {/* Above the button row, not inline beside it — needs to read
              as "why the action below might fail / failed", not a
              trailing caption easy to miss next to the button. */}
          {errorCode && (
            <p
              style={{
                margin: 0,
                padding: "var(--space-3) var(--space-4)",
                borderRadius: "var(--radius-md)",
                background: "rgba(220, 20, 60, 0.08)",
                border: "1px solid rgba(220, 20, 60, 0.3)",
                font: "var(--text-body-sm)",
                color: "crimson",
              }}
            >
              {t("connectError")}
            </p>
          )}
          <div style={{ display: "flex", alignItems: "center", gap: "var(--space-3)" }}>
            <span style={badgeStyle}>{t(`badge.${status}`)}</span>
            {!isActive && (
              <form action={startStripeConnectOnboarding}>
                <Button type="submit" size="sm">
                  {isConnected ? t("continueSetupButton") : t("connectButton")}
                </Button>
              </form>
            )}
          </div>
        </div>
      }
    />
  );
}
