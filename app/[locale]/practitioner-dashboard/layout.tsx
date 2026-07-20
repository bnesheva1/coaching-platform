import type { ReactNode } from "react";
import { getTranslations, getLocale } from "next-intl/server";
import { redirect, Link } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import { createClient } from "@/lib/supabase/server";
import { signOut } from "@/app/actions";
import { NavBar } from "@/components/ui/NavBar";
import { Button } from "@/components/ui/Button";
import { DashboardShell } from "./DashboardShell";

// UTC calendar week (Monday 00:00 through the following Monday), not the
// practitioner's own timezone — an approximation, not a bug: this only
// feeds the sidebar's "pulse" count, a ballpark figure, and computing a
// real per-practitioner-timezone week boundary here would mean fetching
// practitioner_profiles.timezone in this layout just for this one number.
function startOfCurrentUtcWeek(): Date {
  const now = new Date();
  const day = now.getUTCDay();
  const diffToMonday = (day + 6) % 7;
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - diffToMonday));
}

// Auth + role guard, hoisted out of the old single page.tsx so it runs
// once for all six dashboard routes instead of being duplicated in each.
// Also owns the top NavBar and the pulse-card aggregate — both are
// chrome shared by every tab, not any one tab's concern.
export default async function PractitionerDashboardLayout({ children }: { children: ReactNode }) {
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

  if (profile?.role !== "practitioner") {
    redirect({ href: "/client-dashboard", locale });
    return null;
  }

  const weekStart = startOfCurrentUtcWeek();
  const weekEnd = new Date(weekStart.getTime() + 7 * 24 * 60 * 60 * 1000);
  const now = new Date().toISOString();

  // "confirmed"/"completed" only was a bug, not a deliberate choice — a
  // booking made early in the week auto-completes (Epic 8's cron) by the
  // time you check the dashboard mid-week, and would silently drop out
  // of "this week's" count. "pending" is included too now, matching the
  // same status set the agenda widgets below already use for "upcoming".
  const [{ count: sessionCount }, { count: totalUpcoming }] = await Promise.all([
    supabase
      .from("bookings")
      .select("id", { count: "exact", head: true })
      .eq("practitioner_id", user.id)
      .in("status", ["pending", "confirmed", "completed"])
      .gte("start_utc", weekStart.toISOString())
      .lt("start_utc", weekEnd.toISOString()),
    supabase
      .from("bookings")
      .select("id", { count: "exact", head: true })
      .eq("practitioner_id", user.id)
      .in("status", ["pending", "confirmed"])
      .gte("start_utc", now),
  ]);

  const otherLocale = routing.locales.find((l) => l !== locale) ?? locale;
  const langToggleText = locale === "bg" ? "BG · EN" : "EN · BG";

  return (
    <div>
      <NavBar
        wordmark={tHome("title")}
        links={[{ label: tBrowse("title"), href: "/browse" }]}
        mobileMenuLabel={{ open: t("mobileMenuOpen"), close: t("mobileMenuClose") }}
        langToggle={
          // Same mechanism as the homepage's own langToggle
          // (components/LanguageSwitcher.tsx is suppressed there for
          // the identical reason) — same page, other locale.
          <Link
            href="/practitioner-dashboard"
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
      <DashboardShell
        pulse={{
          sessionCount: sessionCount ?? 0,
          totalUpcoming: totalUpcoming ?? 0,
        }}
      >
        {children}
      </DashboardShell>
    </div>
  );
}
