import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { createClient } from "@/lib/supabase/server";
import { Card } from "@/components/ui/Card";

// Placeholder, deliberately — no practitioner-facing "reviews received"
// view exists anywhere in the app yet (confirmed: the only existing
// review-read query is the public profile page's own). No design has
// been provided for this tab either, so this isn't a built-out feature
// standing in for a real one — it's an honest "not built yet" state
// with a link to the one place reviews are actually visible today.
export default async function ReviewsPage() {
  const t = await getTranslations("Dashboard");
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { data: practitionerProfile } = await supabase
    .from("practitioner_profiles")
    .select("username")
    .eq("id", user!.id)
    .single();

  return (
    <main style={{ padding: "var(--space-8) 0" }}>
      {/* No ContentContainer — DashboardShell already bounds/pads the
          sidebar+content row; see profile/page.tsx's identical note. */}
      <div style={{ maxWidth: 500 }}>
        <Card
          title={t("reviewsPlaceholderTitle")}
          description={t("reviewsPlaceholderBody")}
          footer={
            practitionerProfile?.username ? (
              <Link href={`/p/${practitionerProfile.username}`}>{t("viewPublicProfile")}</Link>
            ) : undefined
          }
        />
      </div>
    </main>
  );
}
