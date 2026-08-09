import { getTranslations, getLocale } from "next-intl/server";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { GreetingText } from "@/components/dashboard/GreetingText";
import { PractitionerCard, type PractitionerCardData } from "@/components/browse/PractitionerCard";
import { searchPractitioners } from "@/lib/practitioners/search";
import specialtiesData from "@/data/specialties.json";
import topicsData from "@/data/topics.json";

// A small, fixed number — this is a welcoming nudge toward /browse, not
// a second results grid competing with the real one there.
const SUGGESTED_COUNT = 3;

// Shown by client-dashboard/page.tsx (the dashboard's index route, née
// "Предстоящи"/Upcoming) in place of its normal agenda content when a
// client has no booking history at all — matches Browse's own empty-state pattern
// (Card + single CTA), not the practitioner dashboard's multi-step
// activation checklist, which is specific to setting up a bookable
// profile and has no client equivalent. Reuses PractitionerCard (the
// same browse-grid card) for the suggestions, not a bespoke variant.
export async function ClientActivationState({ displayName }: { displayName: string }) {
  const t = await getTranslations("Dashboard");
  const locale = (await getLocale()) as "bg" | "en";

  const allPractitioners = await searchPractitioners({});
  const specialtyLabelByKey = new Map(specialtiesData.map((s) => [s.key, s[locale] ?? s.en]));
  const topicLabelByKey = new Map(topicsData.map((topic) => [topic.key, topic[locale] ?? topic.en]));
  const suggested: PractitionerCardData[] = allPractitioners
    // Best-rated first — a genuine "suggested" order, not whatever the
    // underlying search RPC happens to return unsorted practitioners in.
    .sort((a, b) => (b.averageRating ?? 0) - (a.averageRating ?? 0))
    .slice(0, SUGGESTED_COUNT)
    .map((p) => ({
      id: p.id,
      username: p.username,
      displayName: p.displayName,
      bio: p.bio,
      avatarUrl: p.avatarUrl,
      specialtyLabels: p.specialties.map((key) => specialtyLabelByKey.get(key) ?? key),
      topicLabels: p.topics.map((key) => topicLabelByKey.get(key) ?? key),
      averageRating: p.averageRating,
      reviewCount: p.reviewCount,
    }));

  return (
    <main style={{ padding: "var(--space-8) 0" }}>
      <Card
        eyebrow={<GreetingText name={displayName} />}
        title={t("clientEmptyState.title")}
        description={t("clientEmptyState.body")}
        footer={
          <Button href="/browse" size="md">
            {t("clientEmptyState.cta")}
          </Button>
        }
      />

      {/* A brief, ordered "how it works" — a genuine sequence, so numbered
          steps are meaningful rather than decorative. Stacks on narrow
          screens, sits in a row when there's room. */}
      <section aria-labelledby="how-it-works-heading" style={{ marginTop: "var(--space-8)" }}>
        <h2 id="how-it-works-heading" style={{ font: "var(--text-heading-md)", margin: "0 0 var(--space-4)" }}>
          {t("clientEmptyState.howHeading")}
        </h2>
        <ol
          style={{
            listStyle: "none",
            margin: 0,
            padding: 0,
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
            gap: "var(--space-4)",
          }}
        >
          {[
            t("clientEmptyState.step1"),
            t("clientEmptyState.step2"),
            t("clientEmptyState.step3"),
            t("clientEmptyState.step4"),
          ].map((label, i) => (
            <li key={label} style={{ display: "flex", alignItems: "center", gap: "var(--space-3)" }}>
              <span
                aria-hidden
                style={{
                  flexShrink: 0,
                  width: 32,
                  height: 32,
                  borderRadius: "50%",
                  background: "var(--accent-subtle)",
                  color: "var(--accent-subtle-text)",
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  font: "var(--text-button-sm)",
                  fontWeight: 700,
                }}
              >
                {i + 1}
              </span>
              <span style={{ font: "var(--text-body-md)", color: "var(--text-primary)" }}>{label}</span>
            </li>
          ))}
        </ol>
      </section>

      {suggested.length > 0 && (
        <section style={{ marginTop: "var(--space-8)" }}>
          <h2 style={{ font: "var(--text-heading-md)", margin: "0 0 var(--space-4)" }}>
            {t("clientEmptyState.suggestedHeading")}
          </h2>
          {/* Same grid recipe as BookedWithGrid.tsx's results grid —
              same card, same layout, not a new visual recipe for what
              happens to be a different data source. */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))",
              gap: "var(--space-4)",
              alignContent: "start",
            }}
          >
            {suggested.map((p) => (
              <PractitionerCard key={p.id} practitioner={p} />
            ))}
          </div>
        </section>
      )}
    </main>
  );
}
