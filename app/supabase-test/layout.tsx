import type { Metadata } from "next";

// The Supabase connection-check page is a Client Component (it can't export
// metadata itself), so this thin server layout carries the robots directive:
// keep the internal test page out of search results.
export const metadata: Metadata = { robots: { index: false, follow: false } };

export default function SupabaseTestLayout({ children }: { children: React.ReactNode }) {
  return children;
}
