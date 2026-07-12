import { Body, Container, Head, Heading, Html, Preview, Text } from "@react-email/components";
import { DeliveryInfoBlock } from "./DeliveryInfoBlock";

// Purely presentational, same reasoning as the other two templates —
// kept as its own file rather than shared, since these three
// notifications are conceptually distinct and likely to diverge once
// the visual-design phase happens. deliveryLabel/deliveryInfo optional
// for the same reason as BookingConfirmationEmail — omit rather than
// render empty when a service has none set.
export function ReminderEmail({
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
