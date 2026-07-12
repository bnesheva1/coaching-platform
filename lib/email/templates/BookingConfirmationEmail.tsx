import { Body, Container, Head, Heading, Html, Preview, Text } from "@react-email/components";
import { DeliveryInfoBlock } from "./DeliveryInfoBlock";

// Purely presentational — every string arrives already translated from
// lib/email/index.ts. No next-intl, no locale, no timezone logic here
// at all, so this survives both a provider swap and an i18n-mechanism
// swap untouched. deliveryLabel/deliveryInfo are optional since a
// service predating this feature (or one missing it despite the
// nudge) may have none set — omit the block entirely rather than
// render an empty one.
export function BookingConfirmationEmail({
  heading,
  body,
  footer,
  deliveryLabel,
  deliveryInfo,
}: {
  heading: string;
  body: string;
  footer: string;
  deliveryLabel?: string;
  deliveryInfo?: string;
}) {
  return (
    <Html>
      <Head />
      <Preview>{heading}</Preview>
      <Body style={{ fontFamily: "sans-serif", backgroundColor: "#f6f6f6", padding: "2rem 0" }}>
        <Container style={{ backgroundColor: "#ffffff", padding: "2rem", borderRadius: 8 }}>
          <Heading as="h1" style={{ fontSize: "1.25rem" }}>
            {heading}
          </Heading>
          <Text>{body}</Text>
          {deliveryLabel && deliveryInfo && <DeliveryInfoBlock label={deliveryLabel} info={deliveryInfo} />}
          <Text style={{ color: "#666", fontSize: "0.85rem", marginTop: "2rem" }}>{footer}</Text>
        </Container>
      </Body>
    </Html>
  );
}
