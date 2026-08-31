import { isEnabled } from "@/lib/flags";
import { SITE_URL } from "@/lib/seo";
import { SUBSCRIPTION_PRICE_CENTS, REQUIRED_STRIPE_V1_EVENTS, REQUIRED_STRIPE_V2_EVENTS } from "@/lib/payments";

// Operator setup reference for practitioner subscription billing — what to set
// in the platform (env + admin) vs. in Stripe. Deliberately English-literal
// (like the health page's own config notes): env-var names and Stripe object
// names are the same in every locale. The platform side is LIVE (shows the
// current state of each value), and the Stripe side lists the exact webhook
// events derived from the code, so this can't drift from what's actually wired.
export async function SubscriptionBillingSetup() {
  const enabled = await isEnabled("subscriptionBilling");
  const priceId = process.env.SUBSCRIPTION_PRICE_ID?.trim();
  const productId = process.env.SUBSCRIPTION_PRODUCT_ID?.trim();
  const webhookSecret = Boolean(process.env.STRIPE_WEBHOOK_SECRET);
  const feeEur = (SUBSCRIPTION_PRICE_CENTS / 100).toFixed(2);
  const webhookUrl = `${SITE_URL}/api/webhooks/stripe`;

  const cardStyle = {
    border: "1px solid var(--border-subtle)",
    borderRadius: "var(--radius-lg)",
    padding: "var(--space-4)",
    display: "flex",
    flexDirection: "column" as const,
    gap: "var(--space-3)",
  };
  const colTitle = { font: "var(--text-body-md)", fontWeight: 600, margin: 0 } as const;
  const listStyle = { margin: 0, paddingLeft: "1.1rem", display: "flex", flexDirection: "column" as const, gap: "var(--space-2)", font: "var(--text-body-sm)", color: "var(--text-secondary)" } as const;
  const mono = { fontFamily: "var(--font-mono, monospace)", color: "var(--text-primary)", wordBreak: "break-word" as const } as const;

  // A small live state chip: green when configured, amber when not.
  const chip = (ok: boolean, label: string) => (
    <span
      style={{
        font: "var(--text-label)",
        textTransform: "uppercase",
        letterSpacing: "0.06em",
        color: ok ? "var(--color-success)" : "var(--color-warning)",
        whiteSpace: "nowrap",
      }}
    >
      {label}
    </span>
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
      <p style={{ margin: 0, font: "var(--text-body-sm)", color: "var(--text-secondary)" }}>
        The monthly platform fee is <strong style={{ color: enabled ? "var(--color-success)" : "var(--color-warning)" }}>{enabled ? "ON" : "OFF (dormant)"}</strong>.
        Complete every item below before switching it on. The “Stripe webhooks” check above verifies the webhook step live.
      </p>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: "var(--space-3)" }}>
        {/* ── In the platform ── */}
        <div style={cardStyle}>
          <p style={colTitle}>In the platform (env vars + admin)</p>
          <ol style={listStyle}>
            <li>
              <div style={{ display: "flex", justifyContent: "space-between", gap: "var(--space-2)", alignItems: "baseline" }}>
                <span><span style={mono}>SUBSCRIPTION_BILLING_ENABLED</span> — the master switch.</span>
                {chip(enabled, enabled ? "on" : "off")}
              </div>
            </li>
            <li>
              <div style={{ display: "flex", justifyContent: "space-between", gap: "var(--space-2)", alignItems: "baseline" }}>
                <span><span style={mono}>SUBSCRIPTION_PRICE_CENTS</span> — default fee, in cents. Keep it equal to the Stripe Price amount.</span>
                {chip(true, `€${feeEur}/mo`)}
              </div>
            </li>
            <li>
              <div style={{ display: "flex", justifyContent: "space-between", gap: "var(--space-2)", alignItems: "baseline" }}>
                <span><span style={mono}>SUBSCRIPTION_PRICE_ID</span> — the Stripe Price for the default fee (Stripe step 2).</span>
                {chip(Boolean(priceId), priceId ? "set" : "unset")}
              </div>
            </li>
            <li>
              <div style={{ display: "flex", justifyContent: "space-between", gap: "var(--space-2)", alignItems: "baseline" }}>
                <span><span style={mono}>SUBSCRIPTION_PRODUCT_ID</span> — the Stripe Product (used for custom per-practitioner amounts).</span>
                {chip(Boolean(productId), productId ? "set" : "unset")}
              </div>
            </li>
            <li>
              <div style={{ display: "flex", justifyContent: "space-between", gap: "var(--space-2)", alignItems: "baseline" }}>
                <span><span style={mono}>STRIPE_WEBHOOK_SECRET</span> — must match the endpoint’s signing secret (Stripe step 3).</span>
                {chip(webhookSecret, webhookSecret ? "set" : "unset")}
              </div>
            </li>
            <li>
              Per-practitioner overrides: <span style={mono}>/admin/practitioners → Set subscription</span> — mark a practitioner
              <strong> exempt</strong> (charged nothing) or set a <strong>custom €/month</strong>. No deploy needed.
            </li>
          </ol>
        </div>

        {/* ── In Stripe ── */}
        <div style={cardStyle}>
          <p style={colTitle}>In Stripe (dashboard)</p>
          <ol style={listStyle}>
            <li>Create a <strong>Product</strong> — “Platform membership”.</li>
            <li>
              Add a <strong>recurring monthly Price</strong> (EUR, e.g. €{feeEur}). Copy the <span style={mono}>price_…</span> id →
              <span style={mono}> SUBSCRIPTION_PRICE_ID</span>, and the <span style={mono}>prod_…</span> id → <span style={mono}>SUBSCRIPTION_PRODUCT_ID</span>.
            </li>
            <li>
              Create a <strong>webhook endpoint</strong> at <span style={mono}>{webhookUrl}</span>, subscribed to these events, then copy its signing secret →
              <span style={mono}> STRIPE_WEBHOOK_SECRET</span>:
              <div style={{ marginTop: "var(--space-1)", display: "flex", flexWrap: "wrap", gap: "4px 8px" }}>
                {[...REQUIRED_STRIPE_V1_EVENTS, ...REQUIRED_STRIPE_V2_EVENTS].map((ev) => (
                  <span
                    key={ev}
                    style={{
                      ...mono,
                      font: "var(--text-caption)",
                      background: "var(--bg-sunken)",
                      padding: "2px 6px",
                      borderRadius: "var(--radius-sm)",
                    }}
                  >
                    {ev}
                  </span>
                ))}
              </div>
              <span style={{ display: "block", marginTop: "var(--space-1)", color: "var(--text-tertiary)" }}>
                The Connect <span style={mono}>v2.core.account*</span> events are a v2 event destination (same URL); the rest are a standard endpoint.
              </span>
            </li>
            <li>
              Enable the <strong>Customer Billing Portal</strong> (Settings → Billing → Customer portal) so practitioners can update their card and manage the subscription — this backs the grace/lapsed “fix” action.
            </li>
          </ol>
        </div>
      </div>
    </div>
  );
}
