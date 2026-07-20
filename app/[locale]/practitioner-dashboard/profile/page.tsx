import { createClient } from "@/lib/supabase/server";
import { getBookableSlots } from "@/lib/availability/slots";
import { PractitionerProfileView } from "@/components/practitioner-profile/PractitionerProfileView";
import { ProfileSettingsBox } from "@/components/practitioner-profile/ProfileSettingsBox";

// Auth/role guard already ran in the shared layout.tsx. isOwner is
// always true here — this route only ever renders for the signed-in
// practitioner viewing their own profile, unlike the public
// p/[username] route which always renders isOwner={false}.
export default async function ProfilePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const userId = user!.id;

  const [{ data: profile }, { data: practitionerProfile }, { data: services }, { data: reviews }] =
    await Promise.all([
      supabase.from("profiles").select("display_name").eq("id", userId).single(),
      supabase
        .from("practitioner_profiles")
        .select("bio, headline, location, specialties, avatar_url, banner_url, username")
        .eq("id", userId)
        .single(),
      // Active only — matches what the public page shows, since this
      // tab previews "what your profile looks like" plus a quick
      // glance, not full inventory management (that stays on the
      // Услуги tab, unchanged).
      supabase
        .from("services")
        .select("id, name, description, duration_minutes, price_cents, currency, image_url")
        .eq("practitioner_id", userId)
        .eq("is_active", true)
        .order("created_at", { ascending: true }),
      supabase
        .from("reviews")
        .select("id, rating, review_text, created_at")
        .eq("practitioner_id", userId)
        .order("created_at", { ascending: false }),
    ]);

  const averageRating =
    reviews && reviews.length > 0 ? reviews.reduce((sum, r) => sum + r.rating, 0) / reviews.length : null;

  // One slot fetch per active service, up front — same reasoning as
  // p/[username]/page.tsx's identical comment: expand/collapse is now
  // local client state, not a `?service=` navigation, so every tile's
  // data needs to already be on hand. viewerRole="practitioner" below
  // still correctly keeps the slots non-clickable (you can't book
  // yourself); this only supplies the real times, not who can click them.
  const slotsByServiceId = Object.fromEntries(
    await Promise.all(
      (services ?? []).map(async (s) => [s.id, await getBookableSlots({ practitionerId: userId, serviceId: s.id })]),
    ),
  ) as Record<string, { startUtc: string }[]>;

  return (
    <main style={{ padding: "var(--space-8) 0" }}>
      {/* No ContentContainer — DashboardShell already bounds/pads the
          sidebar+content row; see the other dashboard pages' identical
          note. Wider than their 500px reading column on purpose — this
          is a visual profile layout (banner/avatar/grid), not a form. */}
      <div style={{ maxWidth: 800, display: "flex", flexDirection: "column", gap: "var(--space-6)" }}>
        <PractitionerProfileView
          isOwner
          practitionerId={userId}
          username={practitionerProfile?.username ?? null}
          displayName={profile?.display_name ?? ""}
          headline={practitionerProfile?.headline ?? ""}
          location={practitionerProfile?.location ?? ""}
          bio={practitionerProfile?.bio ?? ""}
          avatarUrl={practitionerProfile?.avatar_url ?? null}
          bannerUrl={practitionerProfile?.banner_url ?? null}
          specialties={practitionerProfile?.specialties ?? []}
          services={(services ?? []).map((s) => ({
            id: s.id,
            name: s.name,
            description: s.description,
            durationMinutes: s.duration_minutes,
            priceCents: s.price_cents,
            currency: s.currency,
            imageUrl: s.image_url,
          }))}
          reviews={(reviews ?? []).map((r) => ({
            id: r.id,
            rating: r.rating,
            reviewText: r.review_text,
            createdAt: r.created_at,
          }))}
          averageRating={averageRating}
          slotsByServiceId={slotsByServiceId}
          viewerRole="practitioner"
          justBooked={false}
          bookingErrorCode={null}
        />
        <ProfileSettingsBox initialUsername={practitionerProfile?.username ?? null} />
      </div>
    </main>
  );
}
