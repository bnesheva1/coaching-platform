import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { Button } from "@/components/ui/Button";
import { openBillingPortal } from "@/app/[locale]/practitioner-dashboard/subscription-actions";

type SubStatus = "not_required" | "active" | "grace" | "lapsed" | "exempt";

// The subscription-billing counterpart to ModerationNotice: a practitioner
// whose fee payment is failing MUST be told, in plain language, with a direct
// way to fix it — being silently un-bookable with no explanation is the worst
// outcome. Renders only for the two states that need action:
//   grace  — a payment failed, Stripe is retrying (~1 week). Still bookable;
//            this is a "heads up, fix your card" nudge, not a restriction.
//   lapsed — retries exhausted. NOT bookable + not findable, but the profile
//            and all existing bookings are intact and it's fully reversible.
// Both point at the Stripe Billing Portal (update card → retry → active). No
// banner for not_required / active / exempt.
export async function SubscriptionNotice({ subscriptionStatus }: { subscriptionStatus: SubStatus }) {
  if (subscriptionStatus !== "grace" && subscriptionStatus !== "lapsed") return null;
  const t = await getTranslations("Subscription");

  const isLapsed = subscriptionStatus === "lapsed";
  const accent = isLapsed ? "#c0392b" : "#a15c00";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)", marginBottom: "var(--space-4)" }}>
      <div
        style={{
          border: "1px solid var(--border-subtle)",
          borderLeft: `4px solid ${accent}`,
          borderRadius: "var(--radius-md)",
          background: "var(--bg-surface)",
          padding: "var(--space-4)",
          display: "flex",
          flexDirection: "column",
          gap: "var(--space-2)",
        }}
      >
        <span style={{ font: "var(--text-heading-sm)", color: accent }}>
          {t(`${subscriptionStatus}_title` as Parameters<typeof t>[0])}
        </span>
        <p style={{ margin: 0, font: "var(--text-body-md)", color: "var(--text-secondary)" }}>
          {t(`${subscriptionStatus}_body` as Parameters<typeof t>[0])}
        </p>
        <div style={{ display: "flex", alignItems: "center", gap: "var(--space-3)", marginTop: "var(--space-1)" }}>
          <form action={openBillingPortal}>
            <Button type="submit" size="sm">
              {t("fixAction")}
            </Button>
          </form>
          <Link href="/contact" style={{ font: "var(--text-body-sm)", color: "var(--accent)" }}>
            {t("contact")}
          </Link>
        </div>
      </div>
    </div>
  );
}
