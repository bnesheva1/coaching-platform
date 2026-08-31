"use client";

import { useActionState, useState } from "react";
import { useTranslations, useLocale } from "next-intl";
import { Button } from "@/components/ui/Button";
import { Chip } from "@/components/ui/Chip";
import { updateTopics, type ProfileFormState } from "@/app/[locale]/practitioner-dashboard/actions";
import { EditPencilButton } from "./EditPencilButton";
import topicsData from "@/data/topics.json";

const initialState: ProfileFormState = null;

// A curated handful reads as focused; specialties has no such cap (a
// practitioner's modality/method is a factual list, not a pitch), but
// topics is closer to "what to lead with" — capped here AND re-checked
// in updateTopics server-side (this only stops the UI from letting you
// select a 4th; a direct API call could still try).
const MAX_TOPICS = 3;

// Mirrors EditableSpecialties.tsx exactly — same pencil/chip-toggle/save
// pattern, a second independent taxonomy (what a session helps with, not
// the modality/method specialties covers). Plain pills, order follows
// data/topics.json, not sortable.
export function EditableTopics({ topics }: { topics: string[] }) {
  const t = useTranslations("Profile");
  const locale = useLocale() as "en" | "bg";
  const [isEditing, setIsEditing] = useState(false);
  const [selected, setSelected] = useState<string[]>(topics);
  const [state, formAction, pending] = useActionState(updateTopics, initialState);
  // See EditableAbout.tsx's identical comment on why this is adjusted
  // during render rather than via useEffect+setState.
  const [prevState, setPrevState] = useState(state);
  if (state !== prevState) {
    setPrevState(state);
    if (state?.success && isEditing) setIsEditing(false);
  }

  const topicLabel = (key: string) => topicsData.find((topic) => topic.key === key)?.[locale] ?? key;

  if (!isEditing) {
    return (
      <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)", flexWrap: "wrap" }}>
        {topics.length > 0 ? (
          topics.map((key) => (
            <span
              key={key}
              style={{
                font: "var(--text-label)",
                padding: "6px 14px",
                borderRadius: "var(--radius-pill)",
                border: "1px solid var(--border-default)",
                color: "var(--text-secondary)",
              }}
            >
              {topicLabel(key)}
            </span>
          ))
        ) : (
          <span style={{ font: "var(--text-body-sm)", color: "var(--text-tertiary)" }}>{t("topicsEmpty")}</span>
        )}
        <EditPencilButton label={t("editTopics")} onClick={() => setIsEditing(true)} />
      </div>
    );
  }

  const atMax = selected.length >= MAX_TOPICS;

  return (
    <form action={formAction} style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
      <p style={{ margin: 0, font: "var(--text-body-sm)", color: "var(--text-tertiary)" }}>
        {t("topicsHint", { max: MAX_TOPICS, count: selected.length })}
      </p>
      <div style={{ display: "flex", gap: "var(--space-2)", flexWrap: "wrap" }}>
        {topicsData.map((topic) => {
          const isSelected = selected.includes(topic.key);
          return (
            <Chip
              key={topic.key}
              selected={isSelected}
              disabled={!isSelected && atMax}
              onClick={() =>
                setSelected((prev) =>
                  isSelected ? prev.filter((k) => k !== topic.key) : [...prev, topic.key],
                )
              }
            >
              {topic[locale]}
            </Chip>
          );
        })}
      </div>
      {selected.map((key) => (
        <input key={key} type="hidden" name="topics" value={key} />
      ))}
      {state?.error && <p style={{ color: "var(--color-danger)" }}>{state.error}</p>}
      <div style={{ display: "flex", gap: "var(--space-2)" }}>
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? t("saveButtonPending") : t("saveButton")}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => {
            setSelected(topics);
            setIsEditing(false);
          }}
        >
          {t("cancelButton")}
        </Button>
      </div>
    </form>
  );
}
