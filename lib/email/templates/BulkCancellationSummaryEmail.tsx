import { Body, Container, Head, Heading, Html, Preview, Text } from "@react-email/components";

// Sent to the PRACTITIONER when the platform cancels their upcoming bookings on
// their behalf (bulk cancel-and-refund). One summary of the whole operation:
// what was cancelled, for whom, and why. Purely presentational, same style as
// the other templates.
export function BulkCancellationSummaryEmail({
  heading,
  intro,
  reasonLabel,
  reason,
  items,
  footer,
}: {
  heading: string;
  intro: string;
  reasonLabel: string;
  reason: string;
  items: { client: string; service: string; when: string }[];
  footer: string;
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
          <Text>{intro}</Text>
          <Text style={{ fontWeight: "bold", marginBottom: 0 }}>{reasonLabel}</Text>
          <Text style={{ marginTop: 4, whiteSpace: "pre-wrap" }}>{reason}</Text>
          {items.map((it, i) => (
            <Text key={i} style={{ margin: "4px 0", color: "#333" }}>
              {it.when} — {it.service} ({it.client})
            </Text>
          ))}
          <Text style={{ color: "#666", fontSize: "0.85rem", marginTop: "2rem" }}>{footer}</Text>
        </Container>
      </Body>
    </Html>
  );
}
