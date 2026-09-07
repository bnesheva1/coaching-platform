import type { Metadata } from "next";

// The design-system reference page is a Client Component (it can't export
// metadata itself), so this thin server layout carries the robots directive:
// keep the internal component gallery out of search results.
export const metadata: Metadata = { robots: { index: false, follow: false } };

export default function DesignSystemLayout({ children }: { children: React.ReactNode }) {
  return children;
}
