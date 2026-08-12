import { Body, Container, Head, Heading, Html, Preview, Text } from "@react-email/components";

// Internal operator email (English only — not a user-facing surface). Lists
// the alerts newly recorded since the last digest. Kept minimal on purpose.
export function AlertDigestEmail({
  items,
}: {
  items: { severity: string; type: string; message: string; when: string; context: string }[];
}) {
  return (
    <Html>
      <Head />
      <Preview>{`${items.length} alert${items.length === 1 ? "" : "s"} need attention`}</Preview>
      <Body style={{ fontFamily: "sans-serif", color: "#111" }}>
        <Container>
          <Heading as="h2">
            {items.length} alert{items.length === 1 ? "" : "s"} need attention
          </Heading>
          {items.map((it, i) => (
            <Container
              key={i}
              style={{ borderLeft: "3px solid #999", paddingLeft: "12px", marginBottom: "16px" }}
            >
              <Text style={{ margin: 0, fontWeight: 700 }}>
                [{it.severity.toUpperCase()}] {it.type}
              </Text>
              <Text style={{ margin: "2px 0" }}>{it.message}</Text>
              {it.context ? (
                <Text style={{ margin: "2px 0", color: "#555", fontSize: "0.8rem", whiteSpace: "pre-wrap" }}>
                  {it.context}
                </Text>
              ) : null}
              <Text style={{ margin: 0, color: "#888", fontSize: "0.75rem" }}>{it.when}</Text>
            </Container>
          ))}
          <Text style={{ color: "#888", fontSize: "0.8rem", marginTop: "24px" }}>
            Open the admin dashboard to review and dismiss.
          </Text>
        </Container>
      </Body>
    </Html>
  );
}
