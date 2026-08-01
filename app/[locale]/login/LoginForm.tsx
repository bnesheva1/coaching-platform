"use client";

import { useActionState } from "react";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { ContentContainer } from "@/components/ui/ContentContainer";
import { Button } from "@/components/ui/Button";
import { login, type AuthFormState } from "./actions";

const initialState: AuthFormState = null;

export function LoginForm() {
  const t = useTranslations("Auth");
  const [state, formAction, pending] = useActionState(login, initialState);
  // Set by reset-password/actions.ts's redirect after a successful
  // password change — this page doesn't distinguish "arrived here
  // fresh" from "just reset a password," so the confirmation lives in
  // the query string rather than component state.
  const justResetPassword = useSearchParams().get("passwordReset") === "1";

  return (
    <main style={{ padding: "var(--space-16) 0" }}>
      <ContentContainer maxWidth={400}>
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
          <h1 style={{ font: "var(--text-heading-lg)" }}>{t("loginTitle")}</h1>
          {justResetPassword && (
            <p style={{ margin: 0, font: "var(--text-body-sm)", color: "green" }}>
              {t("passwordResetSuccessBanner")}
            </p>
          )}
          <form
            action={formAction}
            style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}
          >
            <label>
              {t("emailLabel")}
              <input name="email" type="email" required className="form-field" style={{ width: "100%" }} />
            </label>
            <label>
              {t("passwordLabel")}
              <input name="password" type="password" required className="form-field" style={{ width: "100%" }} />
            </label>
            <Link href="/forgot-password" style={{ font: "var(--text-body-sm)", color: "var(--accent)", alignSelf: "flex-end" }}>
              {t("forgotPasswordLink")}
            </Link>
            {state?.error && <p style={{ color: "crimson" }}>{state.error}</p>}
            <Button type="submit" disabled={pending}>
              {pending ? t("loginButtonPending") : t("loginButton")}
            </Button>
          </form>
          <p>
            {t.rich("noAccountPrompt", {
              signup: (chunks) => <Link href="/signup">{chunks}</Link>,
            })}
          </p>
        </div>
      </ContentContainer>
    </main>
  );
}
