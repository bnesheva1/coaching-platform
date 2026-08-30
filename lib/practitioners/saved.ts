import "server-only";
import { createClient } from "@/lib/supabase/server";

// A client's saved-practitioner ids, newest-saved first. Uses the request-scoped
// (RLS-enforced) client, so it can only ever return the CALLER'S own saves — the
// table has no read policy for anyone else. Returns [] for a guest.
export async function getSavedPractitionerIds(): Promise<string[]> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return [];
  const { data, error } = await supabase
    .from("saved_practitioners")
    .select("practitioner_id")
    .order("saved_at", { ascending: false });
  if (error) {
    console.error("getSavedPractitionerIds failed", error);
    return [];
  }
  return (data ?? []).map((r) => r.practitioner_id as string);
}

// Card data for the client's saved list, in saved order (newest first). Uses the
// get_practitioner_cards RPC (NOT searchPractitioners) so a saved practitioner who
// has since been hidden/suspended still appears — with `bookable` telling the UI
// whether to offer a booking action. Locale label-mapping is left to the caller,
// matching the search-result → card-data pipeline used elsewhere.
export type SavedPractitionerCard = {
  id: string;
  username: string;
  displayName: string | null;
  bio: string | null;
  avatarUrl: string | null;
  specialtyKeys: string[];
  topicKeys: string[];
  averageRating: number | null;
  reviewCount: number;
  deliveryTypeKeys: string[];
  location: string | null;
  bookable: boolean;
  // Whether the practitioner's profile is still reachable. False for a
  // fully-hidden one (lapsed with no outstanding bookings) — the card stays but
  // must not link to a profile that now shows "not listed".
  visible: boolean;
};

type CardRow = {
  id: string;
  username: string;
  display_name: string | null;
  bio: string | null;
  avatar_url: string | null;
  specialties: string[] | null;
  topics: string[] | null;
  average_rating: number | string | null;
  review_count: number | string | null;
  delivery_types: string[] | null;
  location: string | null;
  bookable: boolean | null;
  visible: boolean | null;
};

export async function getSavedPractitionerCards(): Promise<SavedPractitionerCard[]> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return [];
  const ids = await getSavedPractitionerIds();
  if (ids.length === 0) return [];

  const { data, error } = await supabase.rpc("get_practitioner_cards", { practitioner_ids: ids });
  if (error) {
    console.error("getSavedPractitionerCards failed", error);
    return [];
  }
  const byId = new Map((data ?? []).map((row: CardRow) => [row.id, row]));
  // Preserve saved order (the RPC doesn't guarantee it); drop any id the RPC
  // didn't return (e.g. a since-deleted practitioner).
  return ids
    .map((id) => byId.get(id))
    .filter((row): row is CardRow => !!row)
    .map((row) => ({
      id: row.id,
      username: row.username,
      displayName: row.display_name,
      bio: row.bio,
      avatarUrl: row.avatar_url,
      specialtyKeys: row.specialties ?? [],
      topicKeys: row.topics ?? [],
      averageRating: row.average_rating === null ? null : Number(row.average_rating),
      reviewCount: row.review_count === null ? 0 : Number(row.review_count),
      deliveryTypeKeys: row.delivery_types ?? [],
      location: row.location,
      bookable: !!row.bookable,
      // Default to visible if the RPC somehow omitted it — never hide a card by
      // accident; only an explicit false hides the link.
      visible: row.visible !== false,
    }));
}

// Whether the current client has saved a specific practitioner (for the profile's
// initial toggle state). False for a guest.
export async function isPractitionerSaved(practitionerId: string): Promise<boolean> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return false;
  const { data } = await supabase
    .from("saved_practitioners")
    .select("practitioner_id")
    .eq("practitioner_id", practitionerId)
    .maybeSingle();
  return !!data;
}
