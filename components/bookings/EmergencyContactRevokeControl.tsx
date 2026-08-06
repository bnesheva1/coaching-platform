"use client";

import { useRef, useTransition } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/Button";
import { ConfirmDialog, type ConfirmDialogHandle } from "@/components/ui/ConfirmDialog";
import { setBookingEmergencyContactRevoked } from "@/app/[locale]/practitioner-dashboard/emergency-contact-actions";

// Per-booking, in-advance revocation of the emergency contact, shown on a
// practitioner's upcoming online booking — but only rendered by BookingsList
// while it's still changeable (before the session window opens; the server
// enforces the exact cutoff). Revoking carries the warning at the point of
// decision; restoring is safe and direct. The page revalidates after either
// action, so the status re-renders from fresh server state.
export function EmergencyContactRevokeControl({ bookingId, revoked }: { bookingId: string; revoked: boolean }) {
  const t = useTranslations("Booking");
  const [pending, startTransition] = useTransition();
  const dialogRef = useRef<ConfirmDialogHandle>(null);

  return (
    <div
      style={{
        marginTop: "var(--space-3)",
        display: "flex",
        flexWrap: "wrap",
        alignItems: "center",
        gap: "var(--space-2)",
        font: "var(--text-body-sm)",
        color: "var(--text-tertiary)",
      }}
    >
      <span>{revoked ? t("emergencyContactRevokedForSession") : t("emergencyContactAvailableForSession")}</span>
      {revoked ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={pending}
          onClick={() => startTransition(() => setBookingEmergencyContactRevoked(bookingId, false).then(() => {}))}
        >
          {t("emergencyContactRestore")}
        </Button>
      ) : (
        <>
          <Button type="button" variant="ghost" size="sm" onClick={() => dialogRef.current?.open()}>
            {t("emergencyContactRevoke")}
          </Button>
          <ConfirmDialog
            ref={dialogRef}
            title={t("emergencyContactRevokeTitle")}
            message={t("emergencyContactRevokeWarning")}
            confirmLabel={t("emergencyContactRevoke")}
            cancelLabel={t("emergencyContactRevokeCancel")}
            action={() => setBookingEmergencyContactRevoked(bookingId, true).then(() => {})}
          />
        </>
      )}
    </div>
  );
}
