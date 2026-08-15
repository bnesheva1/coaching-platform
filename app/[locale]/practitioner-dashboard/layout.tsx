import type { ReactNode } from "react";
import { getLocale } from "next-intl/server";
import { redirect } from "@/i18n/navigation";
import { createClient } from "@/lib/supabase/server";
import { DashboardShell } from "@/components/dashboard/DashboardShell";
import { ModerationNotice } from "@/components/dashboard/ModerationNotice";
import { DashboardSidebar } from "./DashboardSidebar";

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
// Owns the pulse-card aggregate — shared by every tab, not any one
// tab's concern. The top header itself now comes from the root locale
// layout's SiteHeader (mounted once, sitewide) — this layout no longer
// renders its own NavBar.
export default async function PractitionerDashboardLayout({ children }: { children: ReactNode }) {
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
    // An admin bounced here would otherwise loop between the two dashboards
    // (each rejects the other's role) — send them to their own surface.
    redirect({ href: profile?.role === "admin" ? "/admin" : "/client-dashboard", locale });
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

  // Moderation state for the practitioner-facing notice (owner-scoped RPC).
  const { data: moderation } = await supabase.rpc("get_my_moderation_status").single();
  const mod = moderation as {
    moderation_status: "active" | "hidden" | "bookings_frozen" | "suspended";
    moderation_reason: string | null;
    payouts_frozen: boolean;
    payouts_reason: string | null;
  } | null;

  return (
    <DashboardShell
      sidebar={<DashboardSidebar pulse={{ sessionCount: sessionCount ?? 0, totalUpcoming: totalUpcoming ?? 0 }} />}
    >
      {mod && (
        <ModerationNotice
          moderationStatus={mod.moderation_status}
          moderationReason={mod.moderation_reason}
          payoutsFrozen={mod.payouts_frozen}
          payoutsReason={mod.payouts_reason}
        />
      )}
      {children}
    </DashboardShell>
  );
}
