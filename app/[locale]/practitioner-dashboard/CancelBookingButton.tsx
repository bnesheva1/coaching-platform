"use client";

import { useTranslations } from "next-intl";
import { cancelBookingAsPractitioner } from "./cancel-booking-actions";

// Split out from BookingsList.tsx (a plain server component — the
// practitioner's timezone is already known server-side, so the list
// itself doesn't need to be a client component) purely because a
// confirm()-gated onSubmit handler requires client-side JS. Everything
// else about the list stays server-rendered.
export function CancelBookingButton({ bookingId }: { bookingId: string }) {
  const t = useTranslations("Booking");

  return (
    <form
      action={cancelBookingAsPractitioner.bind(null, bookingId)}
      style={{ display: "inline" }}
      onSubmit={(e) => {
        if (!confirm(t("cancelConfirm"))) {
          e.preventDefault();
        }
      }}
    >
      <button type="submit">{t("cancelButton")}</button>
    </form>
  );
}
