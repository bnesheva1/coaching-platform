import type { VideoProvider } from "../types";
import { createRoom, closeRoom } from "./rooms";
import { issueJoinCredential } from "./tokens";
import { verifyLiveKitWebhookEvent } from "./webhook";
import { normaliseLiveKitEvent } from "./events";

// The one place the four LiveKit implementation pieces are assembled into
// the provider-agnostic VideoProvider contract. lib/video/index.ts (the
// seam) imports THIS as `provider` and never reaches past it into the
// individual livekit/* modules — the same way lib/payments/index.ts is
// the only thing that knows a Stripe implementation exists.
export const liveKitProvider: VideoProvider = {
  createRoom,
  closeRoom,
  issueJoinCredential,
  async verifyAndNormaliseEvent(rawBody, authHeader) {
    const event = await verifyLiveKitWebhookEvent(rawBody, authHeader); // throws on bad signature
    return normaliseLiveKitEvent(event);
  },
};
