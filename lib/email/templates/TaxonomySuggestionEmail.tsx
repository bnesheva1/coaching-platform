import { Body, Container, Head, Heading, Html, Link, Preview, Text } from "@react-email/components";

// Internal notification to the support inbox: a practitioner suggested a
// domain and/or specialty that isn't in the taxonomy yet. One template carries
// BOTH optional fields (a practitioner can suggest either or both in one submit),
// so only the ones actually given are rendered. All values arrive pre-sanitised
// (newlines/control chars stripped, length-capped) from the action; React Email
// additionally auto-escapes every interpolated value here, so free text can't
// inject markup into the body.
export function TaxonomySuggestionEmail({
  practitionerName,
  profileUrl,
  requestedDomain,
  requestedSpecialty,
  submittedAt,
}: {
  practitionerName: string;
  profileUrl: string;
  requestedDomain: string;
  requestedSpecialty: string;
  submittedAt: string;
}) {
  return (
    <Html>
      <Head />
      <Preview>{`Taxonomy suggestion from ${practitionerName}`}</Preview>
      <Body style={{ fontFamily: "sans-serif", backgroundColor: "#f6f6f6", padding: "2rem 0" }}>
        <Container style={{ backgroundColor: "#ffffff", padding: "2rem", borderRadius: 8 }}>
          <Heading as="h1" style={{ fontSize: "1.25rem" }}>
            Taxonomy suggestion
          </Heading>
          <Text style={{ marginBottom: 0 }}>
            <strong>{practitionerName}</strong>
          </Text>
          <Text style={{ marginTop: 4 }}>
            <Link href={profileUrl}>{profileUrl}</Link>
          </Text>
          {requestedDomain && (
            <Text style={{ marginTop: "1.25rem", marginBottom: 0 }}>
              <strong>Requested domain:</strong> {requestedDomain}
            </Text>
          )}
          {requestedSpecialty && (
            <Text style={{ marginTop: requestedDomain ? 4 : "1.25rem", marginBottom: 0 }}>
              <strong>Requested specialty:</strong> {requestedSpecialty}
            </Text>
          )}
          <Text style={{ marginTop: "1.5rem", fontSize: "0.8125rem", color: "#888" }}>
            Submitted {submittedAt}. This is a suggestion only — nothing was added to the
            taxonomy automatically. The raw text is stored on the practitioner&apos;s profile
            (pending_domain_suggestion / pending_specialty_suggestion).
          </Text>
        </Container>
      </Body>
    </Html>
  );
}
