import type { ReactNode } from "react";
import { getTranslations, getLocale } from "next-intl/server";
import { redirect, Link } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import { createClient } from "@/lib/supabase/server";
import { signOut } from "@/app/actions";
import { NavBar } from "@/components/ui/NavBar";
import { Button } from "@/components/ui/Button";
import { DashboardShell } from "@/components/dashboard/DashboardShell";
import { ClientDashboardSidebar } from "./ClientDashboardSidebar";
import { ClientActivationState } from "./ClientActivationState";

// Auth + role guard, mirroring practitioner-dashboard/layout.tsx —
// hoisted here so it runs once for all three client-dashboard routes
// instead of being duplicated in each. Now also owns the sidebar (same
// DashboardShell/NavItem pattern as the practitioner dashboard, reused
// rather than hand-rolled a second time) and the "no bookings yet"
// activation check: a brand-new client sees the same welcome state no
// matter which of the three sidebar links they land on or click,
// instead of each of the three pages separately reimplementing (and
// duplicating a bookings-existence query for) the identical empty case.
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

  const { data: profile } = await supabase.from("profiles").select("role, display_name").eq("id", user.id).single();

  if (profile?.role !== "client") {
    redirect({ href: "/practitioner-dashboard", locale });
    return null;
  }

  const { count: bookingCount } = await supabase
    .from("bookings")
    .select("id", { count: "exact", head: true })
    .eq("client_id", user.id);
  const hasAnyBookingHistory = (bookingCount ?? 0) > 0;

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
      <DashboardShell sidebar={<ClientDashboardSidebar />}>
        {hasAnyBookingHistory ? children : <ClientActivationState displayName={profile?.display_name ?? ""} />}
      </DashboardShell>
    </div>
  );
}
