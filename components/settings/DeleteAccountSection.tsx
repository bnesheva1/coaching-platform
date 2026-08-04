"use client";

import { useActionState, useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/Button";
import { deleteMyAccount, type DeleteAccountFormState } from "@/app/account-actions";

const initialState: DeleteAccountFormState = null;

// displayName is used as the "type this to confirm" match value (the
// GitHub repo-deletion pattern) rather than a fixed English word like
// "DELETE" — a magic string is awkward on a Bulgarian-first platform
// and would mean maintaining a translated magic word per locale.
// Practitioners also have a stricter `username`, but clients don't have
// one at all (only practitioner_profiles has that column) — display_name
// is the one identity string every account actually has, so it's used
// uniformly for both roles rather than forking the UI per role.
//
// The match check itself is purely client-side gating (enables the
// submit button), not re-verified server-side — see deleteMyAccount's
// own comment for why that's the correct boundary here.
export function DeleteAccountSection({ displayName }: { displayName: string }) {
  const t = useTranslations("AccountSettings");
  const [state, formAction, pending] = useActionState(deleteMyAccount, initialState);
  const [confirmText, setConfirmText] = useState("");
  const matches = confirmText.trim() === displayName;

  return (
    <section
      style={{
        padding: "var(--space-4)",
        border: "1px solid rgba(220, 20, 60, 0.3)",
        borderRadius: "var(--radius-lg)",
        background: "var(--bg-surface)",
      }}
    >
      {/* Native <details>, collapsed by default — same pattern as the
          Schedule tab's own "Advanced" section (MinNoticeHoursForm):
          free keyboard operability and an expanded/collapsed
          announcement to screen readers with no extra aria wiring.
          Collapsed by default so the loudest, most irreversible action
          on this page isn't also the most visually prominent one at a
          glance — the red border on the outer section still flags it as
          sensitive even closed. */}
      <details>
        <summary style={{ cursor: "pointer", font: "var(--text-heading-sm)", color: "crimson" }}>
          {t("deleteAccountTitle")}
        </summary>
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)", marginTop: "var(--space-3)" }}>
          <p style={{ margin: 0, font: "var(--text-body-sm)" }}>{t("deleteAccountIntro")}</p>
          <ul style={{ margin: 0, paddingLeft: "1.25rem", font: "var(--text-body-sm)", color: "var(--text-secondary)" }}>
            <li>{t("deleteAccountConsequence1")}</li>
            <li>{t("deleteAccountConsequence2")}</li>
            <li>{t("deleteAccountConsequence3")}</li>
            <li>{t("deleteAccountConsequence4")}</li>
          </ul>

          <form action={formAction} style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)", maxWidth: 400 }}>
            <label>
              {t("deleteAccountConfirmLabel", { name: displayName })}
              <input
                type="text"
                value={confirmText}
                onChange={(e) => setConfirmText(e.target.value)}
                className="form-field"
                style={{ width: "100%" }}
                autoComplete="off"
              />
            </label>
            {state?.error && <p style={{ color: "crimson", margin: 0 }}>{state.error}</p>}
            <Button type="submit" variant="secondary" disabled={!matches || pending}>
              {pending ? t("deleteAccountButtonPending") : t("deleteAccountButton")}
            </Button>
          </form>
        </div>
      </details>
    </section>
  );
}
