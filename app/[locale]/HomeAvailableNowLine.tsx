import { getTranslations } from "next-intl/server";
import { createClient } from "@/lib/supabase/server";
import { isEnabled } from "@/lib/flags";
import { Link } from "@/i18n/navigation";
import { ContentContainer } from "@/components/ui/ContentContainer";

// A single quiet line beneath the hero — „N практикуващи са на разположение
// сега" — shown only when the feature is on AND at least one bookable, searchable
// practitioner is actually available right now. Renders nothing otherwise (no
// placeholder, no zero-state). Links into Browse where the available-now filter
// lives. Its own async server component so the homepage's fetch stays isolated.
export async function HomeAvailableNowLine() {
  if (!(await isEnabled("immediateBooking"))) return null;

  const supabase = await createClient();
  const { data } = await supabase.rpc("count_available_now_practitioners");
  const count = typeof data === "number" ? data : 0;
  if (count <= 0) return null;

  const t = await getTranslations("HomePage");

  return (
    <ContentContainer>
      <div style={{ padding: "0 0 var(--space-8)" }}>
        <Link
          href="/browse"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "var(--space-2)",
            font: "var(--text-body-sm)",
            fontWeight: 600,
            color: "var(--text-secondary)",
            textDecoration: "none",
          }}
        >
          <span
            aria-hidden="true"
            style={{ width: 8, height: 8, borderRadius: "50%", background: "var(--accent)", flexShrink: 0 }}
          />
          {t("availableNowLine", { count })}
        </Link>
      </div>
    </ContentContainer>
  );
}
