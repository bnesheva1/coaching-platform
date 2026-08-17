"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { PractitionerCard, type PractitionerCardData } from "@/components/browse/PractitionerCard";
import { Button } from "@/components/ui/Button";

// The client dashboard's saved-practitioners section. Reuses the browse card;
// unsaving removes the card immediately (the save toggle lives on the card). Shows
// an explanatory empty state rather than a blank panel when nothing is saved. A
// saved practitioner who's no longer bookable still renders — just with no booking
// action (see `unbookableIds`).
export function SavedPractitionersGrid({
  practitioners,
  unbookableIds,
}: {
  practitioners: PractitionerCardData[];
  unbookableIds: string[];
}) {
  const t = useTranslations("Saved");
  const [list, setList] = useState(practitioners);
  const unbookable = new Set(unbookableIds);

  if (list.length === 0) {
    return (
      <div
        style={{
          background: "var(--bg-surface)",
          border: "1px solid var(--border-subtle)",
          borderRadius: "var(--radius-lg)",
          padding: "var(--space-6)",
          display: "flex",
          flexDirection: "column",
          alignItems: "flex-start",
          gap: "var(--space-4)",
        }}
      >
        <p style={{ margin: 0, font: "var(--text-body-md)", color: "var(--text-secondary)", maxWidth: "60ch" }}>{t("emptyLine")}</p>
        <Button href="/browse" variant="secondary">
          {t("emptyCta")}
        </Button>
      </div>
    );
  }

  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: "var(--space-4)", alignContent: "start" }}>
      {list.map((p) => (
        <PractitionerCard
          key={p.id}
          practitioner={p}
          saveable
          saved
          viewerIsGuest={false}
          bookable={!unbookable.has(p.id)}
          onToggleSave={(nowSaved) => {
            // Unsaving from the saved list removes the card right away.
            if (!nowSaved) setList((prev) => prev.filter((x) => x.id !== p.id));
          }}
        />
      ))}
    </div>
  );
}
