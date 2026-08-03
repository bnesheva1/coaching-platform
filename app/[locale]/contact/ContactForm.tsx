"use client";

import { useActionState, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import Script from "next/script";
import { Turnstile, SCRIPT_URL, DEFAULT_SCRIPT_ID } from "@marsidev/react-turnstile";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { submitContact, type ContactFormState } from "./actions";

const initialState: ContactFormState = null;
const MAX_MESSAGE_LENGTH = 2000;

function FieldError({ id, message }: { id: string; message?: string }) {
  if (!message) return null;
  return (
    <p id={id} role="alert" style={{ margin: "var(--space-1) 0 0", font: "var(--text-body-sm)", color: "crimson" }}>
      {message}
    </p>
  );
}

export function ContactForm() {
  const t = useTranslations("Contact");
  const [state, formAction, pending] = useActionState(submitContact, initialState);
  const errors = state?.errors;

  // Bumped every time the action returns and used as the <form>'s own
  // key below — forces a remount so a corrected defaultValue actually
  // takes effect after a rejected submission (React resets the native
  // form after ANY action completion). Same pattern as
  // ProfileFormState/ServiceFormState; see actions.ts's comment on
  // ContactFormState's own values field for the full reasoning.
  const [prevState, setPrevState] = useState(state);
  const [formKey, setFormKey] = useState(0);
  if (state !== prevState) {
    setPrevState(state);
    setFormKey((k) => k + 1);
  }

  // Focus the first invalid field after a failed submission — the
  // per-field error text alone isn't enough for someone tabbing/using a
  // screen reader to immediately land on what needs fixing. Looked up
  // by id (each field's id matches its name below) rather than a ref,
  // since a single ref typed across three different element types
  // (input/select/textarea) doesn't type-check against any one of
  // their element-specific ref props.
  useEffect(() => {
    if (!errors) return;
    const firstField = Object.keys(errors)[0];
    document.getElementById(firstField)?.focus();
  }, [errors]);

  if (state?.success) {
    return (
      <Card title={t("successTitle")} description={t("successBody")} />
    );
  }

  return (
    <form key={formKey} action={formAction} noValidate style={{ display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
      {/* Manually injecting the Turnstile script (rather than letting
          the component do it) avoids a hydration mismatch — same
          precedent as SignupForm.tsx. */}
      <Script id={DEFAULT_SCRIPT_ID} src={SCRIPT_URL} strategy="afterInteractive" />

      {/* Honeypot — invisible to a real visitor (off-screen, not
          type="hidden", which some bots skip) and aria-hidden so
          assistive tech never lands on it either. A bot scraping every
          field in the form reliably fills it in; a human never does. */}
      <div aria-hidden="true" style={{ position: "absolute", left: -9999, width: 1, height: 1, overflow: "hidden" }}>
        <label>
          Company website
          <input type="text" name="website" tabIndex={-1} autoComplete="off" />
        </label>
      </div>

      <label>
        <span style={{ display: "block", font: "var(--text-label)", marginBottom: "var(--space-1)" }}>{t("nameLabel")}</span>
        <input
          id="name"
          name="name"
          type="text"
          required
          maxLength={100}
          defaultValue={state?.values?.name ?? ""}
          className="form-field"
          style={{ width: "100%" }}
          aria-invalid={!!errors?.name}
          aria-describedby={errors?.name ? "name-error" : undefined}
        />
        <FieldError id="name-error" message={errors?.name} />
      </label>

      <label>
        <span style={{ display: "block", font: "var(--text-label)", marginBottom: "var(--space-1)" }}>{t("emailLabel")}</span>
        <input
          id="email"
          name="email"
          type="email"
          required
          maxLength={254}
          defaultValue={state?.values?.email ?? ""}
          className="form-field"
          style={{ width: "100%" }}
          aria-invalid={!!errors?.email}
          aria-describedby={errors?.email ? "email-error" : undefined}
        />
        <FieldError id="email-error" message={errors?.email} />
      </label>

      <label>
        <span style={{ display: "block", font: "var(--text-label)", marginBottom: "var(--space-1)" }}>{t("categoryLabel")}</span>
        <select
          id="category"
          name="category"
          required
          defaultValue={state?.values?.category ?? ""}
          className="form-field"
          style={{ width: "100%" }}
          aria-invalid={!!errors?.category}
          aria-describedby={errors?.category ? "category-error" : undefined}
        >
          <option value="" disabled>
            —
          </option>
          <option value="booking">{t("categoryBooking")}</option>
          <option value="practitioner">{t("categoryPractitioner")}</option>
          <option value="other">{t("categoryOther")}</option>
        </select>
        <FieldError id="category-error" message={errors?.category} />
      </label>

      <label>
        <span style={{ display: "block", font: "var(--text-label)", marginBottom: "var(--space-1)" }}>{t("messageLabel")}</span>
        <textarea
          id="message"
          name="message"
          required
          rows={6}
          maxLength={MAX_MESSAGE_LENGTH}
          defaultValue={state?.values?.message ?? ""}
          className="form-field"
          style={{ width: "100%" }}
          aria-invalid={!!errors?.message}
          aria-describedby={errors?.message ? "message-error" : undefined}
        />
        <FieldError id="message-error" message={errors?.message} />
      </label>

      {process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY && (
        <Turnstile siteKey={process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY} injectScript={false} />
      )}

      {state?.generalError && (
        <p role="alert" style={{ margin: 0, font: "var(--text-body-sm)", color: "crimson" }}>
          {state.generalError}
        </p>
      )}

      <Button type="submit" disabled={pending}>
        {pending ? t("submitButtonPending") : t("submitButton")}
      </Button>
    </form>
  );
}
