"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { PractitionerCard, type PractitionerCardData } from "@/components/browse/PractitionerCard";

// How many cards show before the see-all toggle — enough to fill a row
// or two on desktop without this secondary zone competing with the
// sessions list above it for attention.
const PREVIEW_COUNT = 6;

// Same grid recipe as BrowseClient.tsx's results grid — same card,
// same layout, deliberately not a new visual recipe for a secondary
// zone that happens to show the identical component.
export function BookedWithGrid({ practitioners }: { practitioners: PractitionerCardData[] }) {
  const t = useTranslations("Dashboard");
  const [expanded, setExpanded] = useState(false);

  const hasMore = practitioners.length > PREVIEW_COUNT;
  const visible = expanded ? practitioners : practitioners.slice(0, PREVIEW_COUNT);

  return (
    <>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))",
          gap: "var(--space-4)",
          alignContent: "start",
        }}
      >
        {visible.map((practitioner) => (
          <PractitionerCard key={practitioner.id} practitioner={practitioner} />
        ))}
      </div>
      {hasMore && (
        <button
          type="button"
          className="focus-ring"
          onClick={() => setExpanded((v) => !v)}
          style={{
            marginTop: "var(--space-4)",
            background: "none",
            border: "none",
            color: "var(--accent)",
            font: "var(--text-label)",
            cursor: "pointer",
            padding: 0,
          }}
        >
          {expanded
            ? t("bookedWith.seeFewer")
            : t("bookedWith.seeAll", { count: practitioners.length })}
        </button>
      )}
    </>
  );
}
