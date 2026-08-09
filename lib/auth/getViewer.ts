import { createClient } from "@/lib/supabase/server";

export type Viewer =
  | { status: "logged-out" }
  | { status: "client"; displayName: string | null }
  | { status: "practitioner"; displayName: string | null; username: string | null };

// Centralizes the auth+role lookup that used to be hand-copied in the
// homepage and both dashboard layouts (createClient + auth.getUser +
// profiles.select("role")), each slightly differently. Read-only — this
// is for SiteHeader's own rendering decision, not an auth guard; the
// dashboard layouts' own redirect()-on-wrong-role checks are a separate
// concern and stay where they are.
export async function getViewer(): Promise<Viewer> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { status: "logged-out" };
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("role, display_name")
    .eq("id", user.id)
    .single();

  if (profile?.role === "practitioner") {
    // Username drives the header's "My profile" link to their public page
    // (/p/{username}). May be null if they haven't set one yet — the header
    // falls back to the dashboard profile editor in that case.
    const { data: pProfile } = await supabase
      .from("practitioner_profiles")
      .select("username")
      .eq("id", user.id)
      .single();
    return { status: "practitioner", displayName: profile.display_name, username: pProfile?.username ?? null };
  }
  return { status: "client", displayName: profile?.display_name ?? null };
}
