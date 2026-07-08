import { getTranslations, getLocale } from "next-intl/server";
import { redirect } from "@/i18n/navigation";
import { createClient } from "@/lib/supabase/server";
import { signOut } from "@/app/actions";

export default async function ClientDashboardPage() {
  const t = await getTranslations("Dashboard");
  const locale = await getLocale();
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect({ href: "/login", locale });
    return null;
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  if (profile?.role !== "client") {
    redirect({ href: "/practitioner-dashboard", locale });
    return null;
  }

  return (
    <main style={{ maxWidth: 400, margin: "4rem auto", fontFamily: "sans-serif" }}>
      <h1>{t("clientTitle")}</h1>
      <form action={signOut}>
        <button type="submit">{t("signOut")}</button>
      </form>
    </main>
  );
}
