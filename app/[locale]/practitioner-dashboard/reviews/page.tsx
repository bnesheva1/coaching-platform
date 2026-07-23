import { getTranslations, getLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { createClient } from "@/lib/supabase/server";
import { Card } from "@/components/ui/Card";

const INTL_LOCALES: Record<string, string> = {
  bg: "bg-BG",
  en: "en-US",
};

// Same column-scoped query as the public profile page and the dashboard
// Profile tab's own reviews preview (see p/[username]/page.tsx) — id,
// rating, review_text, created_at is the entire column grant on this
// table; booking_id and reviewer_display_name are excluded from it
// entirely (not just filtered here), so there is structurally no
// reviewer-identifying data this query could return even by mistake.
// Every reviewer, to the practitioner exactly as to the public, is
// "Verified user" — see Reviews.verifiedUser below.
export default async function ReviewsPage() {
  const t = await getTranslations("Reviews");
  const tDashboard = await getTranslations("Dashboard");
  const locale = await getLocale();
  const intlLocale = INTL_LOCALES[locale] ?? "en-US";
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const userId = user!.id;

  const [{ data: practitionerProfile }, { data: reviews }] = await Promise.all([
    supabase.from("practitioner_profiles").select("username").eq("id", userId).single(),
    supabase
      .from("reviews")
      .select("id, rating, review_text, created_at")
      .eq("practitioner_id", userId)
      .order("created_at", { ascending: false }),
  ]);

  const averageRating =
    reviews && reviews.length > 0 ? reviews.reduce((sum, r) => sum + r.rating, 0) / reviews.length : null;

  const publicProfileLink = practitionerProfile?.username ? (
    <Link href={`/p/${practitionerProfile.username}`}>{tDashboard("viewPublicProfile")}</Link>
  ) : undefined;

  return (
    <main style={{ padding: "var(--space-8) 0" }}>
      {/* No ContentContainer — DashboardShell already bounds/pads the
          sidebar+content row; see profile/page.tsx's identical note. */}
      <div style={{ maxWidth: 500 }}>
        {!reviews || reviews.length === 0 ? (
          <Card title={t("reviewsEmptyTitle")} description={t("reviewsEmptyBody")} footer={publicProfileLink} />
        ) : (
          <>
            {averageRating !== null && (
              <p style={{ margin: "0 0 var(--space-4)", font: "var(--text-heading-sm)" }}>
                {t("averageRatingSummary", { average: averageRating.toFixed(1), count: reviews.length })}
              </p>
            )}
            <ul style={{ listStyle: "none", padding: 0, display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
              {reviews.map((review) => (
                <li
                  key={review.id}
                  style={{
                    background: "var(--bg-surface)",
                    border: "1px solid var(--border-subtle)",
                    borderRadius: "var(--radius-md)",
                    padding: "var(--space-4)",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "var(--space-2)" }}>
                    <span aria-label={t("ratingAriaLabel", { rating: review.rating })} style={{ font: "var(--text-body-md)" }}>
                      <span aria-hidden="true">
                        {"★".repeat(review.rating)}
                        {"☆".repeat(5 - review.rating)}
                      </span>
                    </span>
                    <span style={{ color: "var(--text-tertiary)", font: "var(--text-body-sm)" }}>
                      {new Intl.DateTimeFormat(intlLocale, { dateStyle: "medium" }).format(new Date(review.created_at))}
                    </span>
                  </div>
                  <p style={{ margin: "var(--space-1) 0 0", color: "var(--text-tertiary)", font: "var(--text-body-sm)" }}>
                    {t("verifiedUser")}
                  </p>
                  {review.review_text && <p style={{ margin: "var(--space-2) 0 0" }}>{review.review_text}</p>}
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </main>
  );
}
