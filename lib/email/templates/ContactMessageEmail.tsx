import { Body, Container, Head, Heading, Html, Preview, Text } from "@react-email/components";

// Purely presentational, same convention as every other template in
// this folder — all strings arrive already composed/translated by the
// caller (lib/email/index.ts). This is the one internal-facing email in
// the set (goes to CONTACT_SUPPORT_EMAIL, not a client/practitioner),
// but keeps the same plain layout for consistency rather than a
// different visual language for a one-off.
export function ContactMessageEmail({
  categoryLabel,
  name,
  email,
  message,
}: {
  categoryLabel: string;
  name: string;
  email: string;
  message: string;
}) {
  return (
    <Html>
      <Head />
      <Preview>{`${categoryLabel}: ${name}`}</Preview>
      <Body style={{ fontFamily: "sans-serif", backgroundColor: "#f6f6f6", padding: "2rem 0" }}>
        <Container style={{ backgroundColor: "#ffffff", padding: "2rem", borderRadius: 8 }}>
          <Heading as="h1" style={{ fontSize: "1.25rem" }}>
            {categoryLabel}
          </Heading>
          <Text style={{ marginBottom: 0 }}>
            <strong>{name}</strong> — {email}
          </Text>
          <Text style={{ marginTop: "1.5rem", whiteSpace: "pre-wrap" }}>{message}</Text>
        </Container>
      </Body>
    </Html>
  );
}
