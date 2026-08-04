import type { ReactNode } from "react";
import { getLocale } from "next-intl/server";
import { redirect } from "@/i18n/navigation";
import { createClient } from "@/lib/supabase/server";
import { DashboardShell } from "@/components/dashboard/DashboardShell";
import { ClientDashboardSidebar } from "./ClientDashboardSidebar";

// Auth + role guard, mirroring practitioner-dashboard/layout.tsx —
// hoisted here so it runs once for every client-dashboard route instead
// of being duplicated in each. Owns the sidebar (same DashboardShell/
// NavItem pattern as the practitioner dashboard, reused rather than
// hand-rolled a second time).
//
// The "no bookings yet" activation check used to live here too, always
// substituting ClientActivationState for {children} regardless of which
// route was actually requested — correct back when the only three
// destinations under this layout were all bookings-related views where
// that made sense, but it silently broke the moment a fourth,
// booking-history-independent destination (settings — account deletion,
// data export, marketing consent) was added: it made /client-dashboard/
// settings unreachable for any client who hadn't booked yet, since the
// layout swapped it out for the welcome screen before the settings page
// ever got a chance to render. Server Component layouts have no way to
// know which child route is actually being requested (confirmed against
// Next.js's own docs — pathname is a Client Component-only concern), so
// the fix is structural: this layout now always renders {children}
// unconditionally, and client-dashboard/page.tsx (the one route this
// gate actually belongs to) makes that call itself.
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

  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single();

  if (profile?.role !== "client") {
    redirect({ href: "/practitioner-dashboard", locale });
    return null;
  }

  return <DashboardShell sidebar={<ClientDashboardSidebar />}>{children}</DashboardShell>;
}
