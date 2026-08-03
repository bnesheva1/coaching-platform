"use client";

import { useActionState, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import Script from "next/script";
import { Turnstile, SCRIPT_URL, DEFAULT_SCRIPT_ID } from "@marsidev/react-turnstile";
import { Link } from "@/i18n/navigation";
import { ContentContainer } from "@/components/ui/ContentContainer";
import { Button } from "@/components/ui/Button";
import { signup, type AuthFormState } from "./actions";

const initialState: AuthFormState = null;

export function SignupForm() {
  const t = useTranslations("Auth");
  const [state, formAction, pending] = useActionState(signup, initialState);
  // Pre-selects the practitioner radio when arriving from the
  // "Become a practitioner" page's CTA (/signup?role=practitioner) —
  // otherwise the default-checked "client" radio would silently be the
  // wrong choice for someone who just read a whole page about becoming
  // a practitioner and clicked "Create your profile."
  const roleParam = useSearchParams().get("role");
  const practitionerPreselected = roleParam === "practitioner";
  // Bumped every time the action returns and used as the <form>'s own
  // key below — forces a remount so corrected defaultValues actually
  // take effect after a rejected submission. See AuthFormState's own
  // comment in actions.ts for the full reasoning (password deliberately
  // excluded from what's echoed back and re-filled).
  const [prevState, setPrevState] = useState(state);
  const [formKey, setFormKey] = useState(0);
  if (state !== prevState) {
    setPrevState(state);
    setFormKey((k) => k + 1);
  }
  const selectedRole = state?.values?.role ?? (practitionerPreselected ? "practitioner" : "client");

  return (
    <main style={{ padding: "var(--space-16) 0" }}>
      <ContentContainer maxWidth={400}>
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
          <h1 style={{ font: "var(--text-heading-lg)" }}>{t("signupTitle")}</h1>
          {/* Manually injecting the Turnstile script (rather than letting the
              component do it) avoids a hydration mismatch — recommended by
              the library itself for Next.js App Router. */}
          <Script id={DEFAULT_SCRIPT_ID} src={SCRIPT_URL} strategy="afterInteractive" />
          <form
            key={formKey}
            action={formAction}
            style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}
          >
            <label>
              {t("displayNameLabel")}
              <input name="displayName" type="text" required defaultValue={state?.values?.displayName ?? ""} className="form-field" style={{ width: "100%" }} />
            </label>
            <p style={{ font: "var(--text-body-sm)", color: "#666", marginTop: "calc(-1 * var(--space-2))" }}>
              {t("displayNameHint")}
            </p>
            <label>
              {t("emailLabel")}
              <input name="email" type="email" required defaultValue={state?.values?.email ?? ""} className="form-field" style={{ width: "100%" }} />
            </label>
            <label>
              {t("passwordLabel")}
              <input name="password" type="password" required minLength={12} className="form-field" style={{ width: "100%" }} />
            </label>
            <p style={{ font: "var(--text-body-sm)", color: "#666", marginTop: "calc(-1 * var(--space-2))" }}>
              {t("passwordHint")}
            </p>
            <fieldset>
              <legend>{t("roleLegend")}</legend>
              <label>
                <input type="radio" name="role" value="client" defaultChecked={selectedRole === "client"} />{" "}
                {t("roleClient")}
              </label>
              <br />
              <label>
                <input type="radio" name="role" value="practitioner" defaultChecked={selectedRole === "practitioner"} />{" "}
                {t("rolePractitioner")}
              </label>
            </fieldset>
            {process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY && (
              <Turnstile
                siteKey={process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY}
                injectScript={false}
              />
            )}
            {state?.error && <p style={{ color: "crimson" }}>{state.error}</p>}
            <Button type="submit" disabled={pending}>
              {pending ? t("signupButtonPending") : t("signupButton")}
            </Button>
          </form>
          <p>
            {t.rich("hasAccountPrompt", {
              login: (chunks) => <Link href="/login">{chunks}</Link>,
            })}
          </p>
        </div>
      </ContentContainer>
    </main>
  );
}
