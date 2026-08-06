"use client";

import { useRef, useTransition } from "react";
import { useTranslations } from "next-intl";
import { ConfirmDialog, type ConfirmDialogHandle } from "@/components/ui/ConfirmDialog";
import { setBookingEmergencyContactRevoked } from "@/app/[locale]/practitioner-dashboard/emergency-contact-actions";

// The revoke/restore action reads as an inline text link at the end of the
// explanatory sentence — same accent-colored, borderless treatment as the
// other inline links in this app (e.g. ClientTimezoneNotice), not a button.
const linkStyle = {
  background: "none",
  border: "none",
  padding: 0,
  margin: 0,
  font: "inherit",
  color: "var(--accent)",
  cursor: "pointer",
} as const;

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
    <>
      <p
        style={{
          margin: "var(--space-3) 0 0",
          font: "var(--text-body-sm)",
          color: "var(--text-tertiary)",
        }}
      >
        {revoked ? t("emergencyContactRevokedForSession") : t("emergencyContactAvailableForSession")}{" "}
        {revoked ? (
          <button
            type="button"
            className="focus-ring"
            disabled={pending}
            onClick={() => startTransition(() => setBookingEmergencyContactRevoked(bookingId, false).then(() => {}))}
            style={{ ...linkStyle, cursor: pending ? "default" : "pointer", opacity: pending ? 0.6 : 1 }}
          >
            {t("emergencyContactRestore")}
          </button>
        ) : (
          <button type="button" className="focus-ring" onClick={() => dialogRef.current?.open()} style={linkStyle}>
            {t("emergencyContactRevoke")}
          </button>
        )}
      </p>
      {/* Native <dialog> must sit outside the <p> — it's flow content and
          would otherwise auto-close the paragraph. The ref wires it to the
          inline link above. */}
      {!revoked && (
        <ConfirmDialog
          ref={dialogRef}
          title={t("emergencyContactRevokeTitle")}
          message={t("emergencyContactRevokeWarning")}
          confirmLabel={t("emergencyContactRevoke")}
          cancelLabel={t("emergencyContactRevokeCancel")}
          action={() => setBookingEmergencyContactRevoked(bookingId, true).then(() => {})}
        />
      )}
    </>
  );
}
