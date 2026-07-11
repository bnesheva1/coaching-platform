import { Body, Container, Head, Heading, Html, Preview, Text } from "@react-email/components";

// Purely presentational, same reasoning as BookingConfirmationEmail —
// kept as a separate component (not a shared generic template) since
// these two notifications are conceptually distinct emails that are
// likely to diverge once the visual-design phase happens, even though
// today's layout is intentionally simple and similar.
export function CancellationNoticeEmail({
  heading,
  body,
  footer,
}: {
  heading: string;
  body: string;
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
          <Text>{body}</Text>
          <Text style={{ color: "#666", fontSize: "0.85rem", marginTop: "2rem" }}>{footer}</Text>
        </Container>
      </Body>
    </Html>
  );
}
