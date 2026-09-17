import { getTranslations } from "next-intl/server";
import { createClient } from "@/lib/supabase/server";
import { ContentManager, type ManagedContentItem } from "./ContentManager";

// The owner reads FULL rows (incl. the unlock fields the column grant hides from
// direct SELECT) through get_my_content_items — the only path that returns them
// for editing.
export default async function DigitalProductsPage() {
  const t = await getTranslations("DigitalProducts");
  const supabase = await createClient();
  const { data } = await supabase.rpc("get_my_content_items");
  const items: ManagedContentItem[] = (data ?? []).map((r: Record<string, unknown>) => ({
    id: r.id as string,
    type: r.type as "video_youtube" | "pdf",
    title: r.title as string,
    description: (r.description as string | null) ?? "",
    priceEuros: ((r.price_cents as number) / 100).toString(),
    youtubeVideoId: (r.youtube_video_id as string | null) ?? "",
    hasPdf: !!(r.pdf_storage_path as string | null),
    isActive: r.is_active as boolean,
  }));

  return (
    <main style={{ padding: "var(--space-8) 0" }}>
      <div style={{ maxWidth: 720 }}>
        <h1 style={{ font: "var(--text-heading-lg)", margin: "0 0 var(--space-2)" }}>{t("manageTitle")}</h1>
        <p style={{ font: "var(--text-body-md)", color: "var(--text-secondary)", margin: "0 0 var(--space-6)" }}>{t("manageIntro")}</p>
        <ContentManager items={items} />
      </div>
    </main>
  );
}
