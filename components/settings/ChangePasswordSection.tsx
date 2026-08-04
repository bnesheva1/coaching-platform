"use client";

import { useActionState, useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/Button";
import { changePassword, type ChangePasswordFormState } from "@/app/account-actions";

const initialState: ChangePasswordFormState = null;

// Same form-reset-on-error fix as everywhere else in this app (see
// project memory on the form-reset-on-error fix) would apply here too
// in principle, but password fields are deliberately never echoed back
// or preserved across a rejected submission anywhere in this codebase
// — a wrong current password or a mismatched confirmation just means
// retyping all three, same as signup/reset-password already do. formKey
// still forces a remount so the fields actually clear on error rather
// than showing the rejected values (React 19 leaves the DOM as-is
// otherwise), which matters more here than usual since a failed
// current-password check shouldn't leave it sitting in the input.
export function ChangePasswordSection() {
  const t = useTranslations("AccountSettings");
  const [state, formAction, pending] = useActionState(changePassword, initialState);
  const [prevState, setPrevState] = useState(state);
  const [formKey, setFormKey] = useState(0);
  if (state !== prevState) {
    setPrevState(state);
    setFormKey((k) => k + 1);
  }

  return (
    <section
      style={{
        padding: "var(--space-4)",
        border: "1px solid var(--border-subtle)",
        borderRadius: "var(--radius-lg)",
        background: "var(--bg-surface)",
      }}
    >
      {/* Native <details>, collapsed by default — same pattern as
          DeleteAccountSection.tsx and the Schedule tab's own "Advanced"
          section. */}
      <details>
        <summary style={{ cursor: "pointer", font: "var(--text-heading-sm)" }}>{t("changePasswordTitle")}</summary>
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)", marginTop: "var(--space-3)" }}>
          <p style={{ margin: 0, font: "var(--text-body-sm)", color: "var(--text-tertiary)" }}>
            {t("changePasswordDescription")}
          </p>
          <form key={formKey} action={formAction} style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)", maxWidth: 400 }}>
            <label>
              {t("currentPasswordLabel")}
              <input name="currentPassword" type="password" required autoComplete="current-password" className="form-field" style={{ width: "100%" }} />
            </label>
            <label>
              {t("newPasswordLabel")}
              <input name="newPassword" type="password" required minLength={12} autoComplete="new-password" className="form-field" style={{ width: "100%" }} />
            </label>
            <p style={{ font: "var(--text-body-sm)", color: "var(--text-tertiary)", margin: "calc(-1 * var(--space-1)) 0 0" }}>
              {t("changePasswordHint")}
            </p>
            <label>
              {t("confirmNewPasswordLabel")}
              <input name="confirmNewPassword" type="password" required minLength={12} autoComplete="new-password" className="form-field" style={{ width: "100%" }} />
            </label>
            {state?.error && <p style={{ color: "crimson", margin: 0 }}>{state.error}</p>}
            {state?.success && <p style={{ color: "green", margin: 0 }}>{t("changePasswordSuccess")}</p>}
            <div>
              <Button type="submit" size="sm" disabled={pending}>
                {pending ? t("changePasswordButtonPending") : t("changePasswordButton")}
              </Button>
            </div>
          </form>
        </div>
      </details>
    </section>
  );
}
