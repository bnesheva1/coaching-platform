import { Link } from "@/i18n/navigation";
import { getTranslations } from "next-intl/server";
import { requireAdmin } from "@/lib/auth/requireAdmin";
import { createServiceRoleClient } from "@/lib/supabase/serviceRole";
import { getPractitionerStats } from "@/lib/practitioners/stats";
import { PractitionerStats } from "@/components/practitioners/PractitionerStats";
import { ContentContainer } from "@/components/ui/ContentContainer";

export const dynamic = "force-dynamic";

// Admin view of any practitioner's stats — the same component the practitioner
// sees for themselves. Reached from the admin Practitioners list.
export default async function AdminPractitionerStatsPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdmin();
  const { id } = await params;
  const t = await getTranslations("Stats");

  const supabase = createServiceRoleClient();
  const [{ data: prof }, { data: nameRow }] = await Promise.all([
    supabase.from("practitioner_profiles").select("username").eq("id", id).single(),
    supabase.from("profiles").select("display_name").eq("id", id).single(),
  ]);
  const name = (nameRow?.display_name as string | null) ?? (prof?.username as string | null) ?? "—";

  const stats = await getPractitionerStats(id);

  return (
    <main style={{ padding: "var(--space-8) 0" }}>
      <ContentContainer>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: "var(--space-4)", flexWrap: "wrap", marginBottom: "var(--space-6)" }}>
          <h1 style={{ font: "var(--text-heading-lg)", margin: 0 }}>{t("adminHeading", { name })}</h1>
          <Link href="/admin/practitioners" style={{ font: "var(--text-body-sm)", color: "var(--accent)" }}>
            ← {t("adminBack")}
          </Link>
        </div>
        <PractitionerStats stats={stats} />
      </ContentContainer>
    </main>
  );
}
