import type { ReactNode } from "react";
import { requireAdmin } from "@/lib/auth/requireAdmin";

// Server-side gate on every request to every /admin page (the highest-
// privilege surface). Site chrome (SiteHeader/SiteFooter) still comes from the
// root [locale] layout; this only guards.
export default async function AdminLayout({ children }: { children: ReactNode }) {
  await requireAdmin();
  return <>{children}</>;
}
