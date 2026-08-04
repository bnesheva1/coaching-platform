import { getTranslations } from "next-intl/server";
import { Button } from "@/components/ui/Button";
import {
  startStripeConnectOnboarding,
  manageStripeConnectAccount,
} from "@/app/[locale]/practitioner-dashboard/connect-actions";

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
  manageErrorCode,
}: {
  isConnected: boolean;
  transfersActive: boolean;
  errorCode: string | null;
  manageErrorCode: string | null;
}) {
  const t = await getTranslations("StripeConnect");

  const isActive = isConnected && transfersActive;
  const status = !isConnected ? "notConnected" : isActive ? "active" : "incomplete";
  // errorCode/manageErrorCode are mutually exclusive in practice (each
  // comes back from a different action's own redirect), but resolved to
  // a single message rather than two separate boxes — showing both at
  // once would only happen from a manually-crafted URL with both query
  // params set, not a real user flow.
  const errorMessage = errorCode ? t("connectError") : manageErrorCode ? t("manageError") : null;

  const badgeStyle = {
    font: "var(--text-caption)",
    padding: "2px 10px",
    borderRadius: "var(--radius-pill)",
    background: isActive ? "var(--accent-subtle)" : "var(--bg-sunken)",
    color: isActive ? "var(--accent-subtle-text)" : "var(--text-tertiary)",
  } as const;

  return (
    // Plain bordered section, not the Card component — matches every
    // other Settings section (MarketingConsentSection, UsernameSection,
    // etc.), which all use a flat border instead of Card's shadow-md, so
    // this reads as one consistent list of settings rather than one
    // card standing out with different elevation from its neighbors.
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
        <h2 style={{ margin: 0, font: "var(--text-heading-sm)" }}>{t("title")}</h2>
        <p style={{ margin: "var(--space-1) 0 0", font: "var(--text-body-sm)", color: "var(--text-tertiary)" }}>
          {t(`description.${status}`)}
        </p>
      </div>
      {/* Above the button row, not inline beside it — needs to read as
          "why the action below might fail / failed", not a trailing
          caption easy to miss next to the button. */}
      {errorMessage && (
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
          {errorMessage}
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
        {/* The gap this closes: once active, the button above simply
            stopped rendering — no way back into Stripe to update bank
            details, tax info, or identity documents. Scoped to isActive
            specifically (not isConnected broadly) so the incomplete
            case keeps exactly one button (continueSetupButton, which
            itself also lets a practitioner finish outstanding
            requirements) rather than showing two. */}
        {isActive && (
          <form action={manageStripeConnectAccount}>
            <Button type="submit" size="sm" variant="secondary">
              {t("manageAccountButton")}
            </Button>
          </form>
        )}
      </div>
    </section>
  );
}
