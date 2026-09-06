"use client";

import { useActionState, useState } from "react";
import { useTranslations, useLocale } from "next-intl";
import { Button } from "@/components/ui/Button";
import { Chip } from "@/components/ui/Chip";
import {
  updateSpecialties,
  submitTaxonomySuggestion,
  type ProfileFormState,
} from "@/app/[locale]/practitioner-dashboard/actions";
import { EditPencilButton } from "./EditPencilButton";
import specialtiesData from "@/data/specialties.json";
import domainsData from "@/data/domains.json";

const initialState: ProfileFormState = null;

// Only active domains are selectable (data/domains.json). Each carries the set of
// specialty keys that belong to it — picking a domain narrows the specialty chips
// to just those, and the server re-enforces the same constraint.
const ACTIVE_DOMAINS = domainsData.filter((d) => d.active);

// Domain (single-select, required) + specialties (multi-select, narrowed by the
// chosen domain) live in ONE editor because they're interdependent: the domain
// decides which specialties are offerable, so they save together as a unit.
// Topics stay a separate editor (EditableTopics) — an independent taxonomy.
export function EditableSpecialties({ specialties, domain }: { specialties: string[]; domain: string | null }) {
  const t = useTranslations("Profile");
  const locale = useLocale() as "en" | "bg";
  const [isEditing, setIsEditing] = useState(false);
  const [selectedDomain, setSelectedDomain] = useState<string | null>(domain);
  const [selected, setSelected] = useState<string[]>(specialties);
  const [state, formAction, pending] = useActionState(updateSpecialties, initialState);

  // "Not listed? Suggest one" — its own form + action, revealed on demand.
  const [showSuggest, setShowSuggest] = useState(false);
  const [suggestState, suggestAction, suggestPending] = useActionState(submitTaxonomySuggestion, initialState);

  // See EditableAbout.tsx's identical comment on why this is adjusted
  // during render rather than via useEffect+setState.
  const [prevState, setPrevState] = useState(state);
  if (state !== prevState) {
    setPrevState(state);
    if (state?.success && isEditing) setIsEditing(false);
  }

  const specialtyLabel = (key: string) => specialtiesData.find((s) => s.key === key)?.[locale] ?? key;
  const domainLabel = (key: string) => ACTIVE_DOMAINS.find((d) => d.key === key)?.[locale] ?? key;
  // Specialties offerable under the currently-selected domain (empty until one is picked).
  const domainSpecialties = ACTIVE_DOMAINS.find((d) => d.key === selectedDomain)?.specialties ?? [];

  const selectDomain = (key: string) => {
    setSelectedDomain(key);
    // Drop any selected specialty that doesn't belong to the new domain.
    const allowed = new Set(ACTIVE_DOMAINS.find((d) => d.key === key)?.specialties ?? []);
    setSelected((prev) => prev.filter((s) => allowed.has(s)));
  };

  if (!isEditing) {
    return (
      <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)", flexWrap: "wrap" }}>
        {domain && (
          <span
            style={{
              font: "var(--text-label)",
              padding: "6px 14px",
              borderRadius: "var(--radius-pill)",
              background: "var(--accent)",
              color: "var(--text-on-accent)",
            }}
          >
            {domainLabel(domain)}
          </span>
        )}
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
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
      <form action={formAction} style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
        {/* Domain — single-select, required. */}
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
          <span style={{ font: "var(--text-label)", color: "var(--text-secondary)" }}>{t("domainSelectLabel")}</span>
          <div style={{ display: "flex", gap: "var(--space-2)", flexWrap: "wrap" }}>
            {ACTIVE_DOMAINS.map((d) => (
              <Chip key={d.key} selected={selectedDomain === d.key} onClick={() => selectDomain(d.key)}>
                {d[locale]}
              </Chip>
            ))}
          </div>
        </div>

        {/* Specialties — narrowed to the chosen domain. */}
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
          <span style={{ font: "var(--text-label)", color: "var(--text-secondary)" }}>{t("specialtiesLabel")}</span>
          {selectedDomain ? (
            <div style={{ display: "flex", gap: "var(--space-2)", flexWrap: "wrap" }}>
              {domainSpecialties.map((key) => {
                const isSelected = selected.includes(key);
                return (
                  <Chip
                    key={key}
                    selected={isSelected}
                    onClick={() =>
                      setSelected((prev) => (isSelected ? prev.filter((k) => k !== key) : [...prev, key]))
                    }
                  >
                    {specialtyLabel(key)}
                  </Chip>
                );
              })}
            </div>
          ) : (
            <span style={{ font: "var(--text-body-sm)", color: "var(--text-tertiary)" }}>
              {t("specialtiesPickDomainFirst")}
            </span>
          )}
        </div>

        {selectedDomain && <input type="hidden" name="domain" value={selectedDomain} />}
        {selected.map((key) => (
          <input key={key} type="hidden" name="specialties" value={key} />
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
              setSelectedDomain(domain);
              setSelected(specialties);
              setIsEditing(false);
            }}
          >
            {t("cancelButton")}
          </Button>
        </div>
      </form>

      {/* Escape hatch — for a domain or specialty that isn't in the list. */}
      <div style={{ borderTop: "1px solid var(--border-subtle)", paddingTop: "var(--space-3)" }}>
        {!showSuggest ? (
          <button
            type="button"
            onClick={() => setShowSuggest(true)}
            style={{
              background: "none",
              border: "none",
              padding: 0,
              cursor: "pointer",
              font: "var(--text-body-sm)",
              color: "var(--accent)",
              textDecoration: "underline",
            }}
          >
            {t("suggestToggle")}
          </button>
        ) : suggestState?.success ? (
          <p style={{ margin: 0, font: "var(--text-body-sm)", color: "var(--text-secondary)" }}>{t("suggestSent")}</p>
        ) : (
          <form action={suggestAction} style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
            <span style={{ font: "var(--text-body-sm)", color: "var(--text-tertiary)" }}>{t("suggestHint")}</span>
            <input
              name="requestedDomain"
              maxLength={100}
              placeholder={t("suggestDomainPlaceholder")}
              style={{
                font: "var(--text-body-sm)",
                padding: "8px 12px",
                borderRadius: "var(--radius-md)",
                border: "1px solid var(--border-default)",
                background: "var(--bg-surface)",
                color: "var(--text-primary)",
              }}
            />
            <input
              name="requestedSpecialty"
              maxLength={100}
              placeholder={t("suggestSpecialtyPlaceholder")}
              style={{
                font: "var(--text-body-sm)",
                padding: "8px 12px",
                borderRadius: "var(--radius-md)",
                border: "1px solid var(--border-default)",
                background: "var(--bg-surface)",
                color: "var(--text-primary)",
              }}
            />
            {suggestState?.error && <p style={{ margin: 0, color: "var(--color-danger)" }}>{suggestState.error}</p>}
            <div style={{ display: "flex", gap: "var(--space-2)" }}>
              <Button type="submit" size="sm" disabled={suggestPending}>
                {suggestPending ? t("suggestPending") : t("suggestButton")}
              </Button>
              <Button type="button" variant="ghost" size="sm" onClick={() => setShowSuggest(false)}>
                {t("cancelButton")}
              </Button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
