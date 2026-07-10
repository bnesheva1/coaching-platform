"use client";

import { useActionState } from "react";
import { useTranslations } from "next-intl";
import {
  createAvailabilityException,
  deleteAvailabilityException,
  type AvailabilityExceptionFormState,
} from "./availability-exceptions-actions";

type AvailabilityException = {
  id: string;
  exception_date: string; // "YYYY-MM-DD"
};

const initialState: AvailabilityExceptionFormState = null;

// exception_date has no time-of-day meaning, so it's parsed and
// formatted entirely in UTC — anchoring both ends to the same zone is
// what avoids the classic off-by-one-day bug from letting the runtime
// apply the browser's local zone to a bare date string.
function formatDate(value: string) {
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeZone: "UTC" }).format(
    new Date(`${value}T00:00:00Z`),
  );
}

function todayIsoDate() {
  return new Date().toISOString().slice(0, 10);
}

export function AvailabilityExceptionsSection({
  exceptions,
}: {
  exceptions: AvailabilityException[];
}) {
  const t = useTranslations("AvailabilityExceptions");
  const [state, formAction, pending] = useActionState(createAvailabilityException, initialState);

  const sortedExceptions = [...exceptions].sort((a, b) =>
    a.exception_date.localeCompare(b.exception_date),
  );

  return (
    <section style={{ marginTop: "2rem", maxWidth: 400 }}>
      <h2>{t("title")}</h2>

      {sortedExceptions.length > 0 ? (
        <ul style={{ listStyle: "none", padding: 0 }}>
          {sortedExceptions.map((exception) => (
            <li key={exception.id} style={{ marginBottom: "0.5rem" }}>
              {formatDate(exception.exception_date)}{" "}
              <form
                action={deleteAvailabilityException.bind(null, exception.id)}
                style={{ display: "inline" }}
                onSubmit={(e) => {
                  if (!confirm(t("deleteConfirm", { date: formatDate(exception.exception_date) }))) {
                    e.preventDefault();
                  }
                }}
              >
                <button type="submit">{t("deleteButton")}</button>
              </form>
            </li>
          ))}
        </ul>
      ) : (
        <p style={{ color: "#666" }}>{t("noExceptionsYet")}</p>
      )}

      <form
        action={formAction}
        style={{ display: "flex", flexDirection: "column", gap: "0.5rem", marginTop: "1rem" }}
      >
        <label>
          {t("dateLabel")}
          <input type="date" name="exceptionDate" min={todayIsoDate()} required />
        </label>
        {state?.error && <p style={{ color: "crimson" }}>{state.error}</p>}
        {state?.success && (
          <>
            <p style={{ color: "green" }}>{t("addedMessage")}</p>
            {!!state.warningCount && state.warningCount > 0 && (
              <p style={{ color: "#a15c00" }}>
                {t("existingBookingsWarning", { count: state.warningCount })}
              </p>
            )}
          </>
        )}
        <button type="submit" disabled={pending}>
          {pending ? t("addButtonPending") : t("addButton")}
        </button>
      </form>
    </section>
  );
}
