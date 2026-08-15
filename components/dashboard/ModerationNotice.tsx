import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";

type ModStatus = "active" | "hidden" | "bookings_frozen" | "suspended";

// The practitioner MUST be told when a control is applied — being silently
// invisible with no explanation is the worst version of this (they'd assume the
// platform is broken or nobody wants them, and leave). Renders on every
// dashboard page (mounted in the layout): what's applied, what it means in plain
// language, the admin-written reason, and a way to contact us. Nothing when the
// account is clear.
export async function ModerationNotice({
  moderationStatus,
  moderationReason,
  payoutsFrozen,
  payoutsReason,
}: {
  moderationStatus: ModStatus;
  moderationReason: string | null;
  payoutsFrozen: boolean;
  payoutsReason: string | null;
}) {
  if (moderationStatus === "active" && !payoutsFrozen) return null;
  const t = await getTranslations("Moderation");

  const banner = (accent: string, title: string, body: string, reason: string | null) => (
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
      <span style={{ font: "var(--text-heading-sm)", color: accent }}>{title}</span>
      <p style={{ margin: 0, font: "var(--text-body-md)", color: "var(--text-secondary)" }}>{body}</p>
      {reason && (
        <p style={{ margin: 0, font: "var(--text-body-sm)", color: "var(--text-secondary)" }}>
          <strong>{t("reasonLabel")}</strong> {reason}
        </p>
      )}
      <Link href="/contact" style={{ font: "var(--text-body-sm)", color: "var(--accent)" }}>
        {t("contact")}
      </Link>
    </div>
  );

  const isSuspended = moderationStatus === "suspended";
  const accent = isSuspended ? "#c0392b" : "#a15c00";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)", marginBottom: "var(--space-4)" }}>
      {moderationStatus !== "active" &&
        banner(
          accent,
          t(`${moderationStatus}_title` as Parameters<typeof t>[0]),
          t(`${moderationStatus}_body` as Parameters<typeof t>[0]),
          moderationReason,
        )}
      {payoutsFrozen && banner("#a15c00", t("payouts_title"), t("payouts_body"), payoutsReason)}
    </div>
  );
}
