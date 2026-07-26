import type { ReactNode } from "react";
import { getTranslations, getLocale } from "next-intl/server";
import { redirect, Link } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import { createClient } from "@/lib/supabase/server";
import { signOut } from "@/app/actions";
import { NavBar } from "@/components/ui/NavBar";
import { Button } from "@/components/ui/Button";
import { ContentContainer } from "@/components/ui/ContentContainer";

// Auth + role guard, mirroring practitioner-dashboard/layout.tsx — hoisted
// here so it's ready for any future client-dashboard route, even though
// there's only the one page today. No DashboardShell/sidebar: unlike the
// practitioner side's six tabs, this is a single page with sections, so
// there's nothing to navigate between — just the top NavBar, reused as-is
// (it already takes wordmark/links/langToggle/actions with no role baked
// in, so no changes were needed to make it work here).
export default async function ClientDashboardLayout({ children }: { children: ReactNode }) {
  const t = await getTranslations("Dashboard");
  const tHome = await getTranslations("HomePage");
  const tBrowse = await getTranslations("Browse");
  const locale = await getLocale();
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect({ href: "/login", locale });
    return null;
  }

  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single();

  if (profile?.role !== "client") {
    redirect({ href: "/practitioner-dashboard", locale });
    return null;
  }

  const otherLocale = routing.locales.find((l) => l !== locale) ?? locale;
  const langToggleText = locale === "bg" ? "BG · EN" : "EN · BG";

  return (
    <div>
      <NavBar
        wordmark={tHome("title")}
        links={[{ label: tBrowse("title"), href: "/browse" }]}
        mobileMenuLabel={{ open: t("mobileMenuOpen"), close: t("mobileMenuClose") }}
        langToggle={
          // Same mechanism as the practitioner dashboard's own
          // langToggle (and the homepage's, for the identical reason).
          <Link
            href="/client-dashboard"
            locale={otherLocale}
            style={{
              font: "var(--text-label)",
              letterSpacing: "var(--letter-pill)",
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
          <form action={signOut}>
            <Button variant="ghost" size="sm" type="submit">
              {t("signOut")}
            </Button>
          </form>
        }
      />
      {/* No <main> here — each page supplies its own landmark, same
          convention as every other route in this app (including the
          practitioner dashboard's own DashboardShell, which avoids <main>
          for the identical reason). */}
      <ContentContainer>{children}</ContentContainer>
    </div>
  );
}
