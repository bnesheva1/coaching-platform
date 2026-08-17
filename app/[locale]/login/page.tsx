import { getLocale } from "next-intl/server";
import { redirect } from "@/i18n/navigation";
import { createClient } from "@/lib/supabase/server";
import { LoginForm } from "./LoginForm";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user) {
    const locale = await getLocale();
    // Already logged in but arrived with a return-to (e.g. followed a saved-link):
    // honour a safe same-site path, else fall back to the role home.
    const safeNext = next && next.startsWith("/") && !next.startsWith("//") && !next.includes("\\") ? next : null;
    if (safeNext) redirect({ href: safeNext, locale });

    const { data: profile } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .single();

    redirect({
      href: profile?.role === "practitioner" ? "/practitioner-dashboard" : "/client-dashboard",
      locale,
    });
  }

  return <LoginForm />;
}
