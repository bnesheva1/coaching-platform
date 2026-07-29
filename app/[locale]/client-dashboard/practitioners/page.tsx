import { getTranslations, getLocale } from "next-intl/server";
import { createClient } from "@/lib/supabase/server";
import { Button } from "@/components/ui/Button";
import { type PractitionerCardData } from "@/components/browse/PractitionerCard";
import { BookedWithGrid } from "../BookedWithGrid";
import { searchPractitioners } from "@/lib/practitioners/search";
import specialtiesData from "@/data/specialties.json";
import topicsData from "@/data/topics.json";

// Auth/role guard, and the "no bookings yet" activation branch, already
// ran in layout.tsx.
export default async function ClientPractitionersPage() {
  const t = await getTranslations("Dashboard");
  const locale = (await getLocale()) as "bg" | "en";
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const userId = user!.id;

  const { data: bookings } = await supabase
    .from("bookings")
    .select("practitioner_id, start_utc")
    .eq("client_id", userId);

  const practitionerIds = [...new Set((bookings ?? []).map((b) => b.practitioner_id))];

  // Full reuse of the same search this client would hit on /browse —
  // filtered down to just the practitioners they've booked, below. No
  // new query/RPC: average_rating/review_count are already computed
  // inside search_practitioners.
  const allPractitioners = await searchPractitioners({});

  // Most-recently-booked practitioner first (most relevant for
  // rebooking), derived entirely from the bookings already fetched
  // above, no separate tracking system.
  const lastBookedAtByPractitioner = new Map<string, string>();
  for (const b of bookings ?? []) {
    const existing = lastBookedAtByPractitioner.get(b.practitioner_id);
    if (!existing || b.start_utc > existing) {
      lastBookedAtByPractitioner.set(b.practitioner_id, b.start_utc);
    }
  }
  const specialtyLabelByKey = new Map(specialtiesData.map((s) => [s.key, s[locale] ?? s.en]));
  const topicLabelByKey = new Map(topicsData.map((topic) => [topic.key, topic[locale] ?? topic.en]));
  const bookedWithPractitioners: PractitionerCardData[] = allPractitioners
    .filter((p) => practitionerIds.includes(p.id))
    .sort(
      (a, b) =>
        (lastBookedAtByPractitioner.get(b.id) ?? "").localeCompare(lastBookedAtByPractitioner.get(a.id) ?? ""),
    )
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
      <h1 style={{ font: "var(--text-heading-lg)", margin: "0 0 var(--space-6)" }}>{t("nav.clientPractitioners")}</h1>
      <BookedWithGrid practitioners={bookedWithPractitioners} />
      <div style={{ marginTop: "var(--space-8)", display: "flex", justifyContent: "center" }}>
        <Button href="/browse" variant="secondary">
          {t("clientEmptyState.cta")}
        </Button>
      </div>
    </main>
  );
}
