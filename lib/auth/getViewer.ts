import { createClient } from "@/lib/supabase/server";

export type Viewer =
  | { status: "logged-out" }
  | { status: "client"; displayName: string | null }
  | { status: "practitioner"; displayName: string | null };

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
    return { status: "practitioner", displayName: profile.display_name };
  }
  return { status: "client", displayName: profile?.display_name ?? null };
}
