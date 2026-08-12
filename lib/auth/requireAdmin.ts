import { notFound } from "next/navigation";
import { getLocale } from "next-intl/server";
import { redirect } from "@/i18n/navigation";
import { createClient } from "@/lib/supabase/server";

export type AdminUser = { id: string; email: string | null };

// The one server-side gate for the admin surface. Called by /admin's layout —
// so it runs on every request to every /admin page — and as the first line of
// every admin action in later slices. Real server-side auth: never a client
// check, never relying on the URL being unlisted.
//
//   logged-out           -> redirect to /login
//   authenticated, !admin -> notFound() (the route never confirms it exists)
//   admin                -> the verified user
export async function requireAdmin(): Promise<AdminUser> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect({ href: "/login", locale: await getLocale() });
  }

  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user!.id).single();
  if (profile?.role !== "admin") {
    notFound();
  }

  return { id: user!.id, email: user!.email ?? null };
}
