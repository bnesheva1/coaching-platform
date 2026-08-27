// Next.js calls register() once per server instance at boot — the
// framework's startup hook. We use it as a lightweight config guard:
// warn (never throw) when a value-based config env var that fails CLOSED
// at runtime is missing, so a misconfigured deployment surfaces one clear
// line in the boot logs instead of silently swallowing, say, every email.
//
// These vars deliberately have NO code fallback (sending from a wrong
// address, or to a wrong inbox, is worse than not sending — see
// lib/email/*), so this is the right place to make their absence loud
// without changing that fail-closed behaviour. Warn-only on purpose:
// a missing support inbox must not take the whole app down at boot.
export async function register() {
  // Only the Node.js server runtime runs these paths; skip the Edge
  // runtime (middleware) so the warning isn't duplicated or fired where
  // it's irrelevant.
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const RECOMMENDED: { name: string; impact: string }[] = [
    { name: "RESEND_FROM_EMAIL", impact: "all outgoing email fails closed (booking confirmations, reminders, alerts)" },
    { name: "CONTACT_SUPPORT_EMAIL", impact: "the contact form fails and the daily alert digest is skipped" },
  ];

  const missing = RECOMMENDED.filter((v) => !process.env[v.name]?.trim());
  if (missing.length > 0) {
    console.warn(
      "[config] Missing recommended environment variable(s) — the dependent feature stays disabled until each is set:\n" +
        missing.map((v) => `  • ${v.name} — ${v.impact}`).join("\n"),
    );
  }
}
