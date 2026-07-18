import type { Metadata } from "next";
import { getTranslations, getLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import { createClient } from "@/lib/supabase/server";
import { signOut } from "@/app/actions";
import { NavBar } from "@/components/ui/NavBar";
import { Button } from "@/components/ui/Button";
import { Hero } from "./Hero";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("HomePage");
  return { title: t("title"), description: t("metaDescription") };
}

export default async function Home() {
  const t = await getTranslations("HomePage");
  const locale = await getLocale();
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  let profile: { role: string; display_name: string | null } | null = null;
  if (user) {
    const { data } = await supabase
      .from("profiles")
      .select("role, display_name")
      .eq("id", user.id)
      .single();
    profile = data;
  }

  const otherLocale = routing.locales.find((l) => l !== locale) ?? locale;
  const langToggleText = locale === "bg" ? "BG · EN" : "EN · BG";

  return (
    <div>
      <NavBar
        wordmark={t("title")}
        links={[t("navForClients"), t("navForPractitioners"), t("navHowItWorks")]}
        langToggle={
          // Same pathname (this page), just under the other locale —
          // identical mechanism to components/LanguageSwitcher.tsx,
          // which is suppressed on this exact route (see that file) so
          // this is the only language control shown here.
          <Link
            href="/"
            locale={otherLocale}
            style={{
              font: "600 13px/1 var(--font-ui)",
              letterSpacing: ".02em",
              padding: "6px 12px",
              borderRadius: "var(--radius-pill)",
              border: "1px solid var(--border-strong)",
              color: "var(--text-primary)",
              textDecoration: "none",
            }}
          >
            {langToggleText}
          </Link>
        }
        actions={
          user ? (
            <>
              <Button variant="ghost" size="sm" href={profile?.role === "practitioner" ? "/practitioner-dashboard" : "/client-dashboard"}>
                {t("dashboardLink")}
              </Button>
              <form action={signOut}>
                <Button variant="primary" size="sm" type="submit">
                  {t("signOut")}
                </Button>
              </form>
            </>
          ) : (
            <>
              <Button variant="ghost" size="sm" href="/login">
                {t("navLogin")}
              </Button>
              <Button variant="primary" size="sm" href="/signup">
                {t("navSignup")}
              </Button>
            </>
          )
        }
      />
      <Hero />
    </div>
  );
}
