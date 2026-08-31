"use client";

import { useActionState, useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/Button";
import { createReview, type ReviewFormState } from "./review-actions";

const initialState: ReviewFormState = null;

export function LeaveReviewForm({ bookingId }: { bookingId: string }) {
  const t = useTranslations("Reviews");
  const action = createReview.bind(null, bookingId);
  const [state, formAction, pending] = useActionState(action, initialState);
  // Bumped every time the action returns and used as the <form>'s own
  // key below — forces a remount so a corrected defaultValue/
  // defaultChecked actually takes effect after a rejected submission.
  // See ReviewFormState's own comment in review-actions.ts.
  const [prevState, setPrevState] = useState(state);
  const [formKey, setFormKey] = useState(0);
  if (state !== prevState) {
    setPrevState(state);
    setFormKey((k) => k + 1);
  }

  if (state?.success) {
    return <p style={{ color: "var(--color-success)", margin: "var(--space-1) 0 0" }}>{t("submittedMessage")}</p>;
  }

  return (
    <form key={formKey} action={formAction} style={{ marginTop: "var(--space-2)" }}>
      {/* Radio inputs trigger a browser's native implicit form submission
          on Enter when there's a single submit button in the form — a
          user pressing Enter right after picking a star (before ever
          reaching the textarea) would silently submit with no review
          text. Scoped to the fieldset only, so Enter still inserts a
          newline in the textarea as normal. */}
      <fieldset
        style={{ border: "1px solid var(--border-subtle)", borderRadius: "var(--radius-sm)", padding: "var(--space-2)" }}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.preventDefault();
        }}
      >
        <legend>{t("ratingLabel")}</legend>
        {[1, 2, 3, 4, 5].map((value) => (
          <label key={value} style={{ marginRight: "var(--space-3)" }}>
            <input type="radio" name="rating" value={value} defaultChecked={state?.values?.rating === String(value)} required /> {value}
          </label>
        ))}
      </fieldset>
      <textarea
        name="reviewText"
        placeholder={t("reviewTextPlaceholder")}
        maxLength={1000}
        rows={3}
        defaultValue={state?.values?.reviewText ?? ""}
        className="form-field"
        style={{ width: "100%", marginTop: "var(--space-2)" }}
      />
      {state?.error && <p style={{ color: "var(--color-danger)" }}>{state.error}</p>}
      <Button type="submit" disabled={pending}>
        {pending ? t("submitButtonPending") : t("submitButton")}
      </Button>
    </form>
  );
}
