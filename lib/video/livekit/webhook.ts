import { WebhookReceiver } from "livekit-server-sdk";
import { liveKitCredentials } from "./client";

let receiver: WebhookReceiver | null = null;

function getReceiver(): WebhookReceiver {
  if (!receiver) {
    const { apiKey, apiSecret } = liveKitCredentials();
    receiver = new WebhookReceiver(apiKey, apiSecret);
  }
  return receiver;
}

// The LiveKit analog to Stripe's constructEvent: verifies the JWT in the
// Authorization header against the RAW body using the same API key/secret
// pair (there is NO separate webhook signing secret). Throws on any
// verification failure; the route maps that to a 400, exactly as the
// Stripe webhook route does. Must be given the untouched request text —
// re-serialising a parsed body would fail verification even for a genuine
// event.
export async function verifyLiveKitWebhookEvent(rawBody: string, authHeader: string | null) {
  return getReceiver().receive(rawBody, authHeader ?? undefined);
}
