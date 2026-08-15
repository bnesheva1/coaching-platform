import { Link } from "@/i18n/navigation";
import { getTranslations } from "next-intl/server";
import { requireAdmin } from "@/lib/auth/requireAdmin";
import { createServiceRoleClient } from "@/lib/supabase/serviceRole";
import { previewBulkCancel } from "@/lib/admin/bulkCancel";
import { ContentContainer } from "@/components/ui/ContentContainer";
import { BulkCancelConfirm } from "@/components/admin/BulkCancelConfirm";

export const dynamic = "force-dynamic";

export default async function BulkCancelPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdmin();
  const { id } = await params;
  const t = await getTranslations("Admin");

  const supabase = createServiceRoleClient();
  const { data: prof } = await supabase.from("practitioner_profiles").select("username").eq("id", id).single();
  const { data: nameRow } = await supabase.from("profiles").select("display_name").eq("id", id).single();
  const username = (prof?.username as string | null) ?? null;
  const name = (nameRow?.display_name as string | null) ?? username ?? "—";

  const preview = await previewBulkCancel(id);

  return (
    <main style={{ padding: "var(--space-8) 0" }}>
      <ContentContainer>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: "var(--space-4)", flexWrap: "wrap", marginBottom: "var(--space-4)" }}>
          <h1 style={{ font: "var(--text-heading-lg)", margin: 0 }}>{t("bulkHeading", { name })}</h1>
          <Link href="/admin/practitioners" style={{ font: "var(--text-body-sm)", color: "var(--accent)" }}>
            ← {t("healthBackToAdmin")}
          </Link>
        </div>

        {/* The client component owns preview → confirm → report, so the outcome
            report survives the server re-render that a successful run triggers
            (by which point the preview is empty). */}
        <BulkCancelConfirm practitionerId={id} username={username ?? ""} preview={preview} />
      </ContentContainer>
    </main>
  );
}
