import { Body, Container, Head, Heading, Html, Preview, Text } from "@react-email/components";

// Warns a party that a document attached to their session is about to be
// permanently deleted (retention window). Purely presentational, same
// shape as ReminderEmail — a document vanishing unannounced is worse than
// one that was never offered, so this notice exists to give both sides a
// chance to download anything they want to keep.
export function SessionDocumentExpiryEmail({
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
