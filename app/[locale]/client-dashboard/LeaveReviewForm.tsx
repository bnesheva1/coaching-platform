"use client";

import { useActionState } from "react";
import { useTranslations } from "next-intl";
import { createReview, type ReviewFormState } from "./review-actions";

const initialState: ReviewFormState = null;

export function LeaveReviewForm({ bookingId }: { bookingId: string }) {
  const t = useTranslations("Reviews");
  const action = createReview.bind(null, bookingId);
  const [state, formAction, pending] = useActionState(action, initialState);

  if (state?.success) {
    return <p style={{ color: "green", margin: "0.25rem 0 0" }}>{t("submittedMessage")}</p>;
  }

  return (
    <form action={formAction} style={{ marginTop: "0.5rem" }}>
      {/* Radio inputs trigger a browser's native implicit form submission
          on Enter when there's a single submit button in the form — a
          user pressing Enter right after picking a star (before ever
          reaching the textarea) would silently submit with no review
          text. Scoped to the fieldset only, so Enter still inserts a
          newline in the textarea as normal. */}
      <fieldset
        style={{ border: "1px solid #ddd", padding: "0.5rem" }}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.preventDefault();
        }}
      >
        <legend>{t("ratingLabel")}</legend>
        {[1, 2, 3, 4, 5].map((value) => (
          <label key={value} style={{ marginRight: "0.75rem" }}>
            <input type="radio" name="rating" value={value} required /> {value}
          </label>
        ))}
      </fieldset>
      <textarea
        name="reviewText"
        placeholder={t("reviewTextPlaceholder")}
        maxLength={1000}
        rows={3}
        style={{ width: "100%", marginTop: "0.5rem" }}
      />
      {state?.error && <p style={{ color: "crimson" }}>{state.error}</p>}
      <button type="submit" disabled={pending}>
        {pending ? t("submitButtonPending") : t("submitButton")}
      </button>
    </form>
  );
}
