import { createClient } from "@/lib/supabase/server";

// PGroonga's &@~ operator parses the input as a small query language
// (supports -exclude, OR, quoted phrases, etc.) — an unbounded string is a
// cheap way to make it do unnecessary work, so cap it here, the one place
// all search callers go through.
const MAX_SEARCH_LENGTH = 200;

export type PractitionerSearchResult = {
  id: string;
  username: string;
  displayName: string | null;
  bio: string | null;
  avatarUrl: string | null;
  specialties: string[];
  averageRating: number | null;
  reviewCount: number;
};

// Shape returned by the search_practitioners SQL function, before we
// rename its snake_case columns to the camelCase fields above.
type SearchPractitionersRow = {
  id: string;
  username: string;
  display_name: string | null;
  bio: string | null;
  avatar_url: string | null;
  specialties: string[] | null;
  average_rating: number | string | null;
  review_count: number | string | null;
};

// The single place that knows how to find practitioners — a page calls
// this, it doesn't build the query itself. Backed by the
// search_practitioners SQL function (see the migration for the actual
// matching logic and RLS notes); this layer just calls it and normalizes
// the shape. Any future caller (an API route, a semantic-search layer,
// etc.) can reuse this same function or call the RPC directly.
export async function searchPractitioners({
  specialtyKeys,
  searchText,
}: {
  specialtyKeys?: string[];
  searchText?: string;
}): Promise<PractitionerSearchResult[]> {
  const supabase = await createClient();

  const trimmedSearchText = searchText?.trim().slice(0, MAX_SEARCH_LENGTH) || null;

  const { data, error } = await supabase.rpc("search_practitioners", {
    specialty_keys: specialtyKeys && specialtyKeys.length > 0 ? specialtyKeys : null,
    search_query: trimmedSearchText,
  });

  if (error) {
    console.error("searchPractitioners failed:", error);
    throw new Error("Unable to search practitioners right now.");
  }

  // Postgres numeric/bigint columns can come back as strings over
  // PostgREST (bigint especially, to avoid JS float precision loss) —
  // normalize both to real numbers here, the one place this RPC's rows
  // get shaped.
  return (data ?? []).map((row: SearchPractitionersRow) => ({
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    bio: row.bio,
    avatarUrl: row.avatar_url,
    specialties: row.specialties ?? [],
    averageRating: row.average_rating === null ? null : Number(row.average_rating),
    reviewCount: row.review_count === null ? 0 : Number(row.review_count),
  }));
}
