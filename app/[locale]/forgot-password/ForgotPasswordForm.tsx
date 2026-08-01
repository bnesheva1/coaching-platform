"use client";

import { useActionState } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { ContentContainer } from "@/components/ui/ContentContainer";
import { Button } from "@/components/ui/Button";
import { requestPasswordReset, type AuthFormState } from "./actions";

const initialState: AuthFormState = null;

// Same shape as LoginForm/SignupForm — the only real difference from
// those is that success here is never visible on THIS page: it's
// always a redirect to /forgot-password/check-email, on every path
// (rate-limited aside), by design — see actions.ts's own comment on why.
export function ForgotPasswordForm() {
  const t = useTranslations("Auth");
  const [state, formAction, pending] = useActionState(requestPasswordReset, initialState);

  return (
    <main style={{ padding: "var(--space-16) 0" }}>
      <ContentContainer maxWidth={400}>
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
          <h1 style={{ font: "var(--text-heading-lg)" }}>{t("forgotPasswordTitle")}</h1>
          <p style={{ margin: 0, font: "var(--text-body-md)", color: "var(--text-secondary)" }}>
            {t("forgotPasswordIntro")}
          </p>
          <form action={formAction} style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
            <label>
              {t("emailLabel")}
              <input name="email" type="email" required className="form-field" style={{ width: "100%" }} />
            </label>
            {state?.error && <p style={{ color: "crimson" }}>{state.error}</p>}
            <Button type="submit" disabled={pending}>
              {pending ? t("sendResetLinkButtonPending") : t("sendResetLinkButton")}
            </Button>
          </form>
          <p>
            <Link href="/login" style={{ color: "var(--accent)" }}>
              {t("loginTitle")}
            </Link>
          </p>
        </div>
      </ContentContainer>
    </main>
  );
}
