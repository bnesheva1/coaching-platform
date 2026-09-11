import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { SubmitForReviewButton } from "./SubmitForReviewButton";
import type { ReactNode } from "react";

type ModStatus = "pending" | "active" | "changes_requested" | "hidden" | "bookings_frozen" | "suspended";

// The practitioner MUST be told what state their profile is in — being silently
// invisible with no explanation is the worst version of this (they'd assume the
// platform is broken and leave). Renders on every dashboard page (mounted in the
// layout): the review-gate states (pending draft / in review / changes
// requested) and the post-approval controls (hidden / bookings frozen /
// suspended / payouts frozen). Nothing when the account is clear (active, no
// freeze).
export async function ModerationNotice({
  moderationStatus,
  moderationReason,
  reviewSubmittedAt,
  payoutsFrozen,
  payoutsReason,
}: {
  moderationStatus: ModStatus;
  moderationReason: string | null;
  reviewSubmittedAt: string | null;
  payoutsFrozen: boolean;
  payoutsReason: string | null;
}) {
  if (moderationStatus === "active" && !payoutsFrozen) return null;
  const t = await getTranslations("Moderation");

  const banner = (
    accent: string,
    title: string,
    body: string,
    opts?: { reasonLabel?: string; reason?: string | null; extra?: ReactNode },
  ) => (
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
      {opts?.reason && (
        <p style={{ margin: 0, font: "var(--text-body-sm)", color: "var(--text-secondary)" }}>
          <strong>{opts.reasonLabel ?? t("reasonLabel")}</strong> {opts.reason}
        </p>
      )}
      {opts?.extra}
      <Link href="/kontakti" style={{ font: "var(--text-body-sm)", color: "var(--accent)" }}>
        {t("contact")}
      </Link>
    </div>
  );

  // Review-gate states take priority (they're mutually exclusive with the
  // post-approval controls — a profile can't be both pending AND hidden).
  const reviewGate = (): ReactNode => {
    if (moderationStatus === "pending") {
      // Draft (not yet submitted) shows the submit prompt + button; once
      // submitted it's the neutral "in review" notice.
      if (!reviewSubmittedAt) {
        return banner("var(--accent)", t("pending_draft_title"), t("pending_draft_body"), {
          extra: <SubmitForReviewButton label={t("submitReviewButton")} errorText={t("submitError")} />,
        });
      }
      return banner("var(--accent)", t("pending_review_title"), t("pending_review_body"));
    }
    if (moderationStatus === "changes_requested") {
      return banner("var(--color-warning)", t("changes_requested_title"), t("changes_requested_body"), {
        reasonLabel: t("changesReasonLabel"),
        reason: moderationReason,
        extra: <SubmitForReviewButton label={t("resubmitButton")} errorText={t("submitError")} />,
      });
    }
    // Post-approval controls: reuse the generic `${status}_title/_body` keys.
    if (moderationStatus === "hidden" || moderationStatus === "bookings_frozen" || moderationStatus === "suspended") {
      const accent = moderationStatus === "suspended" ? "var(--color-danger)" : "var(--color-warning)";
      return banner(
        accent,
        t(`${moderationStatus}_title` as Parameters<typeof t>[0]),
        t(`${moderationStatus}_body` as Parameters<typeof t>[0]),
        { reason: moderationReason },
      );
    }
    return null;
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)", marginBottom: "var(--space-4)" }}>
      {reviewGate()}
      {payoutsFrozen && banner("var(--color-warning)", t("payouts_title"), t("payouts_body"), { reason: payoutsReason })}
    </div>
  );
}
