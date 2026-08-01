import { Body, Button, Container, Head, Heading, Html, Preview, Text } from "@react-email/components";

// Purely presentational, same convention as every other template in
// this folder — all strings arrive already translated from
// lib/email/index.ts. actionLink is Supabase's own generateLink()
// output relayed as-is — this template never constructs or touches the
// token itself, just renders whatever link it was given.
export function PasswordResetEmail({
  heading,
  body,
  buttonLabel,
  actionLink,
  ignoreNote,
  footer,
}: {
  heading: string;
  body: string;
  buttonLabel: string;
  actionLink: string;
  ignoreNote: string;
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
          <Button
            href={actionLink}
            style={{
              display: "inline-block",
              background: "#000000",
              color: "#ffffff",
              padding: "0.75rem 1.5rem",
              borderRadius: 6,
              textDecoration: "none",
              margin: "0.5rem 0 1.5rem",
            }}
          >
            {buttonLabel}
          </Button>
          <Text style={{ color: "#666", fontSize: "0.85rem" }}>{ignoreNote}</Text>
          <Text style={{ color: "#666", fontSize: "0.85rem", marginTop: "2rem" }}>{footer}</Text>
        </Container>
      </Body>
    </Html>
  );
}
