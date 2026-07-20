"use client";

import { useActionState, useState } from "react";
import { useTranslations, useLocale } from "next-intl";
import { Button } from "@/components/ui/Button";
import { Chip } from "@/components/ui/Chip";
import { updateSpecialties, type ProfileFormState } from "@/app/[locale]/practitioner-dashboard/actions";
import { EditPencilButton } from "./EditPencilButton";
import specialtiesData from "@/data/specialties.json";

const initialState: ProfileFormState = null;

// Plain pills, not sortable — order always follows data/specialties.json
// (unchanged from how the old checkbox list worked). "Sortable" in an
// earlier ask turned out to mean the Browse page's filter chips, not
// this page.
export function EditableSpecialties({ specialties }: { specialties: string[] }) {
  const t = useTranslations("Profile");
  const locale = useLocale() as "en" | "bg";
  const [isEditing, setIsEditing] = useState(false);
  const [selected, setSelected] = useState<string[]>(specialties);
  const [state, formAction, pending] = useActionState(updateSpecialties, initialState);
  // See EditableAbout.tsx's identical comment on why this is adjusted
  // during render rather than via useEffect+setState.
  const [prevState, setPrevState] = useState(state);
  if (state !== prevState) {
    setPrevState(state);
    if (state?.success && isEditing) setIsEditing(false);
  }

  const specialtyLabel = (key: string) => specialtiesData.find((s) => s.key === key)?.[locale] ?? key;

  if (!isEditing) {
    return (
      <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)", flexWrap: "wrap" }}>
        {specialties.length > 0 ? (
          specialties.map((key) => (
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
              {specialtyLabel(key)}
            </span>
          ))
        ) : (
          <span style={{ font: "var(--text-body-sm)", color: "var(--text-tertiary)" }}>{t("specialtiesEmpty")}</span>
        )}
        <EditPencilButton label={t("editSpecialties")} onClick={() => setIsEditing(true)} />
      </div>
    );
  }

  return (
    <form action={formAction} style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
      <div style={{ display: "flex", gap: "var(--space-2)", flexWrap: "wrap" }}>
        {specialtiesData.map((specialty) => {
          const isSelected = selected.includes(specialty.key);
          return (
            <Chip
              key={specialty.key}
              selected={isSelected}
              onClick={() =>
                setSelected((prev) =>
                  isSelected ? prev.filter((k) => k !== specialty.key) : [...prev, specialty.key],
                )
              }
            >
              {specialty[locale]}
            </Chip>
          );
        })}
      </div>
      {selected.map((key) => (
        <input key={key} type="hidden" name="specialties" value={key} />
      ))}
      {state?.error && <p style={{ color: "crimson" }}>{state.error}</p>}
      <div style={{ display: "flex", gap: "var(--space-2)" }}>
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? t("saveButtonPending") : t("saveButton")}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => {
            setSelected(specialties);
            setIsEditing(false);
          }}
        >
          {t("cancelButton")}
        </Button>
      </div>
    </form>
  );
}
