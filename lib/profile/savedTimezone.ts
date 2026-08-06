import { createServiceRoleClient } from "@/lib/supabase/serviceRole";

// profiles.timezone is deliberately excluded from the client-readable
// column grant (RPC/service-role only, alongside email/locale — see
// 20260713100000_profiles_email_locale_timezone.sql), so a client can't
// read even their OWN timezone via a plain select(). This reads a user's
// own saved timezone server-side for display resolution. Scoped to the
// passed id by the caller (always the current user's own id); never used
// to read another user's timezone. Returns null when unset.
export async function getSavedTimezone(userId: string): Promise<string | null> {
  const supabase = createServiceRoleClient();
  const { data, error } = await supabase.from("profiles").select("timezone").eq("id", userId).single();
  if (error) {
    console.error("getSavedTimezone: read failed", { userId, error });
    return null;
  }
  return (data?.timezone as string | null) ?? null;
}
