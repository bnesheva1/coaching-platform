import { Fragment } from "react";
import { Link, Text } from "@react-email/components";
import { splitTextAndUrls } from "@/lib/linkify";

// Shared by BookingConfirmationEmail and ReminderEmail — unlike the
// heading/body/footer shape (kept separate per template deliberately,
// since that content is conceptually distinct per event type), this is
// a pure mechanical rendering concern (turn free text with a possible
// URL into clickable markup) with no reason to diverge between the two
// places it's used. Not used by CancellationNoticeEmail — a cancelled
// session's delivery info is deliberately never shown, see
// lib/email/index.ts's sendCancellationNoticeEmail.
export function DeliveryInfoBlock({ label, info }: { label: string; info: string }) {
  return (
    <Text style={{ backgroundColor: "#f0f4f8", padding: "0.75rem", borderRadius: 4 }}>
      <strong>{label}</strong>
      <br />
      {splitTextAndUrls(info).map((segment, i) =>
        segment.type === "url" ? (
          <Link key={i} href={segment.value}>
            {segment.value}
          </Link>
        ) : (
          <Fragment key={i}>{segment.value}</Fragment>
        ),
      )}
    </Text>
  );
}
