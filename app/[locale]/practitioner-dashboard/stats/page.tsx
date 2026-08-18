import { getTranslations } from "next-intl/server";
import { createClient } from "@/lib/supabase/server";
import { getPractitionerStats } from "@/lib/practitioners/stats";
import { PractitionerStats } from "@/components/practitioners/PractitionerStats";

// The full stats page. Auth + practitioner-role guard runs once in the dashboard
// layout, so this just resolves the current practitioner and renders.
export default async function PractitionerStatsPage() {
  const t = await getTranslations("Stats");
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const stats = await getPractitionerStats(user!.id);

  return (
    <main style={{ padding: "var(--space-8) 0" }}>
      <div style={{ maxWidth: 900 }}>
        <h1 style={{ font: "var(--text-heading-lg)", margin: "0 0 var(--space-6)" }}>{t("title")}</h1>
        <PractitionerStats stats={stats} />
      </div>
    </main>
  );
}
