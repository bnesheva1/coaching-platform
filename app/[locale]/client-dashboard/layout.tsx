import type { ReactNode } from "react";
import { getLocale } from "next-intl/server";
import { redirect } from "@/i18n/navigation";
import { createClient } from "@/lib/supabase/server";
import { DashboardShell } from "@/components/dashboard/DashboardShell";
import { ClientDashboardSidebar } from "./ClientDashboardSidebar";
import { ClientActivationState } from "./ClientActivationState";

// Auth + role guard, mirroring practitioner-dashboard/layout.tsx —
// hoisted here so it runs once for all three client-dashboard routes
// instead of being duplicated in each. Owns the sidebar (same
// DashboardShell/NavItem pattern as the practitioner dashboard, reused
// rather than hand-rolled a second time) and the "no bookings yet"
// activation check: a brand-new client sees the same welcome state no
// matter which of the three sidebar links they land on or click,
// instead of each of the three pages separately reimplementing (and
// duplicating a bookings-existence query for) the identical empty case.
// The top header itself now comes from the root locale layout's
// SiteHeader (mounted once, sitewide) — this layout no longer renders
// its own NavBar.
export default async function ClientDashboardLayout({ children }: { children: ReactNode }) {
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

  return (
    <DashboardShell sidebar={<ClientDashboardSidebar />}>
      {hasAnyBookingHistory ? children : <ClientActivationState displayName={profile?.display_name ?? ""} />}
    </DashboardShell>
  );
}
