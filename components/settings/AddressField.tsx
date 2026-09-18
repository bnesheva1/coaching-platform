"use client";

import { useActionState, useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/Button";
import { EditPencilButton } from "@/components/practitioner-profile/EditPencilButton";
import { saveAddress, type AddressState } from "@/app/[locale]/practitioner-dashboard/address-actions";
import type { PractitionerAddress } from "@/lib/tax/address";

const initialState: AddressState = null;
const field = { display: "flex", flexDirection: "column", gap: "var(--space-1)" } as const;
const labelStyle = { font: "var(--text-label)", color: "var(--text-tertiary)" } as const;

// The practitioner's structured mailing address for DAC7. Sensitive: stored
// excluded from every read grant; only ever shown to the practitioner themselves.
// View/edit toggle; validated server-side.
export function AddressField({ initial }: { initial: PractitionerAddress | null }) {
  const t = useTranslations("TaxId");
  const [isEditing, setIsEditing] = useState(false);
  const [state, formAction, pending] = useActionState(saveAddress, initialState);
  const [a, setA] = useState<PractitionerAddress>(
    initial ?? { street: "", building: "", postcode: "", city: "", country: "BG" },
  );
  const set = (k: keyof PractitionerAddress) => (e: React.ChangeEvent<HTMLInputElement>) => setA((prev) => ({ ...prev, [k]: e.target.value }));

  const [prevState, setPrevState] = useState(state);
  if (state !== prevState) {
    setPrevState(state);
    if (state?.success && isEditing) setIsEditing(false);
  }

  const shown = state?.success ? a : initial;
  const oneLine = shown ? `${shown.street} ${shown.building}, ${shown.postcode} ${shown.city}, ${shown.country}` : "";

  return (
    <section
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "var(--space-2)",
        padding: "var(--space-4)",
        border: "1px solid var(--border-subtle)",
        borderRadius: "var(--radius-lg)",
        background: "var(--bg-surface)",
      }}
    >
      <h2 style={{ margin: 0, font: "var(--text-heading-sm)" }}>{t("addrTitle")}</h2>
      <p style={{ margin: 0, font: "var(--text-body-sm)", color: "var(--text-secondary)" }}>{t("addrDescription")}</p>

      {!isEditing ? (
        <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)" }}>
          <p style={{ margin: 0, font: "var(--text-body-md)" }}>
            {oneLine ? <strong>{oneLine}</strong> : <span style={{ color: "var(--text-tertiary)" }}>{t("notSet")}</span>}
          </p>
          <EditPencilButton label={t("edit")} onClick={() => setIsEditing(true)} />
        </div>
      ) : (
        <form action={formAction} style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)", maxWidth: 460 }}>
          <label style={field}>
            <span style={labelStyle}>{t("addrStreet")}</span>
            <input name="street" value={a.street} onChange={set("street")} maxLength={200} className="form-field" autoComplete="address-line1" />
          </label>
          <div style={{ display: "flex", gap: "var(--space-2)" }}>
            <label style={{ ...field, flex: "0 0 30%" }}>
              <span style={labelStyle}>{t("addrBuilding")}</span>
              <input name="building" value={a.building} onChange={set("building")} maxLength={30} className="form-field" />
            </label>
            <label style={{ ...field, flex: 1 }}>
              <span style={labelStyle}>{t("addrPostcode")}</span>
              <input name="postcode" value={a.postcode} onChange={set("postcode")} maxLength={12} className="form-field" autoComplete="postal-code" />
            </label>
          </div>
          <div style={{ display: "flex", gap: "var(--space-2)" }}>
            <label style={{ ...field, flex: 1 }}>
              <span style={labelStyle}>{t("addrCity")}</span>
              <input name="city" value={a.city} onChange={set("city")} maxLength={100} className="form-field" autoComplete="address-level2" />
            </label>
            <label style={{ ...field, flex: "0 0 30%" }}>
              <span style={labelStyle}>{t("addrCountry")}</span>
              <input name="country" value={a.country} onChange={set("country")} maxLength={2} className="form-field" autoComplete="country" style={{ textTransform: "uppercase" }} />
            </label>
          </div>
          {state?.error && <p style={{ color: "var(--color-danger)", margin: 0 }}>{state.error}</p>}
          <div style={{ display: "flex", gap: "var(--space-2)" }}>
            <Button type="submit" size="sm" disabled={pending}>
              {pending ? t("saving") : t("save")}
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={() => { setA(initial ?? { street: "", building: "", postcode: "", city: "", country: "BG" }); setIsEditing(false); }}>
              {t("cancel")}
            </Button>
          </div>
        </form>
      )}
    </section>
  );
}
