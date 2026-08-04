import { ContentContainer } from "@/components/ui/ContentContainer";
import { ConfirmEmailForm } from "./ConfirmEmailForm";

// No server-side session check here — same reasoning as
// reset-password/page.tsx: the confirmation token arrives in the URL
// fragment, which the server never sees at all.
export default function ConfirmEmailPage() {
  return (
    <main style={{ padding: "var(--space-16) 0" }}>
      <ContentContainer maxWidth={400}>
        <ConfirmEmailForm />
      </ContentContainer>
    </main>
  );
}
