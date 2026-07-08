import { createClient } from "@/lib/supabase/server";

export type PractitionerSearchResult = {
  id: string;
  username: string;
  displayName: string | null;
  bio: string | null;
  avatarUrl: string | null;
  specialties: string[];
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

  const { data, error } = await supabase.rpc("search_practitioners", {
    specialty_keys: specialtyKeys && specialtyKeys.length > 0 ? specialtyKeys : null,
    search_text: searchText?.trim() || null,
  });

  if (error) {
    throw new Error(error.message);
  }

  return (data ?? []).map((row: SearchPractitionersRow) => ({
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    bio: row.bio,
    avatarUrl: row.avatar_url,
    specialties: row.specialties ?? [],
  }));
}
