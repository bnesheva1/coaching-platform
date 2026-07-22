import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getBookableSlots } from "@/lib/availability/slots";
import { BOOKING_WINDOW_DAYS } from "@/lib/availability/generateSlots";
import { getOwnBookingsWithPractitioner } from "@/lib/bookings/ownBookings";
import { ContentContainer } from "@/components/ui/ContentContainer";
import { PractitionerProfileView } from "@/components/practitioner-profile/PractitionerProfileView";

// isOwner is always false here — even the practitioner viewing their
// own public link only ever sees the static view. Editing happens on
// the dashboard's Profile tab (practitioner-dashboard/profile/page.tsx),
// a separate route rendering the same shared component with isOwner
// true, per the explicit view/edit split this was built around.
export default async function PublicProfilePage({
  params,
  searchParams,
}: {
  params: Promise<{ username: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const { username } = await params;
  const normalizedUsername = username.toLowerCase();
  const resolvedSearchParams = await searchParams;

  const supabase = await createClient();

  const { data: practitionerProfile } = await supabase
    .from("practitioner_profiles")
    .select("id, bio, headline, location, specialties, avatar_url, banner_url, username, timezone")
    .eq("username", normalizedUsername)
    .single();

  // No matching username — including a practitioner who hasn't set one
  // yet — means there is simply no live page here.
  if (!practitionerProfile) {
    notFound();
  }

  const [{ data: profile }, { data: services }, { data: authData }, { data: reviews }] = await Promise.all([
    supabase.from("profiles").select("display_name").eq("id", practitionerProfile.id).single(),
    supabase
      .from("services")
      .select("id, name, description, duration_minutes, price_cents, currency, image_url")
      .eq("practitioner_id", practitionerProfile.id)
      .eq("is_active", true)
      .order("created_at", { ascending: true }),
    supabase.auth.getUser(),
    // Public grant (rating, review_text, created_at) — booking_id is
    // excluded from it entirely, and there's no name column at all: every
    // review is shown as "Verified user", to the public and the
    // practitioner alike, never any identifying detail.
    supabase
      .from("reviews")
      .select("id, rating, review_text, created_at")
      .eq("practitioner_id", practitionerProfile.id)
      .order("created_at", { ascending: false }),
  ]);

  const averageRating =
    reviews && reviews.length > 0
      ? reviews.reduce((sum, r) => sum + r.rating, 0) / reviews.length
      : null;

  // The VIEWER's own role (not the practitioner-being-viewed's) —
  // determines whether SlotPicker shows real book buttons, an
  // "only clients can book" note, or a log-in prompt. Can't be part of
  // the Promise.all above since it depends on that call's own result.
  const { data: viewerProfile } = authData.user
    ? await supabase.from("profiles").select("role").eq("id", authData.user.id).single()
    : { data: null };
  const viewerRole: "client" | "practitioner" | null =
    viewerProfile?.role === "client" || viewerProfile?.role === "practitioner"
      ? viewerProfile.role
      : null;

  // Only a client can structurally have "own bookings" with this
  // practitioner to mark on the picker — RLS itself also scopes this to
  // the caller's own rows (see getOwnBookingsWithPractitioner), but
  // skipping the query entirely for every other viewerRole avoids a
  // pointless round trip.
  const ownBookings =
    viewerRole === "client"
      ? await getOwnBookingsWithPractitioner({ practitionerId: practitionerProfile.id })
      : [];

  // One slot fetch per active service, up front — the expand/collapse
  // toggle on each tile is now purely local client state (no more
  // `?service=` navigation, which was the "page jumps" / feels-like-a-
  // reload problem), so the data has to already be on hand rather than
  // fetched reactively off a search param. Services lists here are
  // small in practice; this trades a slightly larger initial page load
  // for an instant, smooth expand with no network wait at all.
  const slotsByServiceId = Object.fromEntries(
    await Promise.all(
      (services ?? []).map(async (s) => [
        s.id,
        await getBookableSlots({ practitionerId: practitionerProfile.id, serviceId: s.id }),
      ]),
    ),
  ) as Record<string, { startUtc: string }[]>;

  const justBooked = resolvedSearchParams.booked === "1";
  const bookingErrorCode =
    typeof resolvedSearchParams.bookingError === "string" ? resolvedSearchParams.bookingError : null;

  return (
    <main style={{ padding: "var(--space-8) 0" }}>
      <ContentContainer maxWidth={700}>
        <PractitionerProfileView
          isOwner={false}
          practitionerId={practitionerProfile.id}
          username={practitionerProfile.username}
          displayName={profile?.display_name || `@${practitionerProfile.username}`}
          headline={practitionerProfile.headline ?? ""}
          location={practitionerProfile.location ?? ""}
          bio={practitionerProfile.bio ?? ""}
          avatarUrl={practitionerProfile.avatar_url}
          bannerUrl={practitionerProfile.banner_url}
          specialties={practitionerProfile.specialties ?? []}
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
          ownBookings={ownBookings}
          bookingWindowDays={BOOKING_WINDOW_DAYS}
          viewerRole={viewerRole}
          justBooked={justBooked}
          bookingErrorCode={bookingErrorCode}
        />
      </ContentContainer>
    </main>
  );
}
