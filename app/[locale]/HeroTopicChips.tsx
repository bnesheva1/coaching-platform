"use client";

import { useState } from "react";
import { Chip } from "@/components/ui/Chip";

// The one interactive piece of the hero — kept in its own narrow
// Client Component boundary so the rest of Hero.tsx (the actual
// crawlable marketing copy) stays server-rendered. Toggle-only local
// UI state, per the design bundle's own prompt.md ("lightweight local
// UI state") — not wired into search filtering yet: these are
// life-topic labels, not the same taxonomy as data/specialties.json's
// practitioner specialties, and reconciling that is a separate,
// deferred decision.
export function HeroTopicChips({ topics }: { topics: string[] }) {
  const [selected, setSelected] = useState<string | null>(null);

  return (
    <div style={{ display: "flex", gap: "var(--space-2)", flexWrap: "wrap", marginTop: "var(--space-1)" }}>
      {topics.map((topic) => (
        <Chip
          key={topic}
          selected={selected === topic}
          onClick={() => setSelected((current) => (current === topic ? null : topic))}
        >
          {topic}
        </Chip>
      ))}
    </div>
  );
}
