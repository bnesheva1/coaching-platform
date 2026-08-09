"use client";

import { useSyncExternalStore } from "react";
import { useTranslations, useLocale } from "next-intl";
import { CancelSessionDialog } from "./CancelSessionDialog";
import { cancelBookingAsClient } from "@/app/[locale]/client-dashboard/cancel-booking-actions";
import { hasSessionStarted, isPastCancellationCutoff } from "@/lib/booking-time";

const INTL_LOCALES: Record<string, string> = {
  bg: "bg-BG",
  en: "en-US",
};

function subscribeToNothing() {
  return () => {};
}
function getDetectedTimezone(): string | null {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return null;
  }
}
function getServerTimezoneSnapshot(): string | null {
  return null;
}

// The client-dashboard "next session" hero card is deliberately excluded
// from the Upcoming list below it (BookingsList.tsx), to avoid showing
// the same booking twice — but that meant the ONE most common case (a
// client with exactly one upcoming booking) had no way to cancel at
// all, since the hero card itself never had a cancel action. This is
// that action, factored out rather than duplicated inline: same
// timezone-detection and notice-window logic BookingsList.tsx already
// has for its own list rows, reused here instead of copied.
export function NextSessionCancelAction({
  bookingId,
  counterpartName,
  startUtc,
  minNoticeHours,
}: {
  bookingId: string;
  counterpartName: string;
  startUtc: string;
  minNoticeHours: number;
}) {
  const t = useTranslations("Booking");
  const locale = useLocale();
  const intlLocale = INTL_LOCALES[locale] ?? "en-US";

  const detectedTimezone = useSyncExternalStore(subscribeToNothing, getDetectedTimezone, getServerTimezoneSnapshot);
  const effectiveTimezone = detectedTimezone ?? "UTC";

  const sessionTimeLabel = new Intl.DateTimeFormat(intlLocale, {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: effectiveTimezone,
  }).format(new Date(startUtc));

  // Session already in progress — no cancel affordance at all (not even the
  // notice text): it's happening, not something to cancel.
  if (hasSessionStarted(startUtc)) {
    return null;
  }

  if (isPastCancellationCutoff(startUtc, minNoticeHours)) {
    return (
      <span style={{ font: "var(--text-body-sm)", color: "var(--text-tertiary)" }}>
        {t("cancelWindowNote", { hours: minNoticeHours })}
      </span>
    );
  }

  return (
    <CancelSessionDialog
      counterpartName={counterpartName}
      sessionTimeLabel={sessionTimeLabel}
      perspective="client"
      action={cancelBookingAsClient.bind(null, bookingId, effectiveTimezone)}
    />
  );
}
