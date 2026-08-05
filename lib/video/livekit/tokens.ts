import { AccessToken } from "livekit-server-sdk";
import { liveKitCredentials } from "./client";
import type { JoinCredential, JoinCredentialInput } from "../types";

export async function issueJoinCredential(input: JoinCredentialInput): Promise<JoinCredential> {
  const { apiKey, apiSecret, wsUrl } = liveKitCredentials();

  // ttl is the whole enforcement of the upper time bound: the token
  // expires at closes_at. The LOWER bound (no join before opens_at) is
  // enforced by the seam refusing to call this at all before the window —
  // AccessToken has no "not before" claim, so there is nothing to set for
  // it here. Floor at 1s so an issue right at closes_at still produces a
  // (near-instantly-expiring) valid token rather than a negative ttl.
  const ttlSeconds = Math.max(1, Math.floor((input.expiresAt.getTime() - Date.now()) / 1000));

  const token = new AccessToken(apiKey, apiSecret, {
    identity: input.participantId,
    name: input.displayName,
    ttl: ttlSeconds,
    // Role is carried so the client SDK can render it; attendance role is
    // still resolved server-side from booking parties, never trusted from
    // here.
    metadata: JSON.stringify({ role: input.participantRole }),
  });
  token.addGrant({
    room: input.bookingId, // scoped to THIS booking's room only
    roomJoin: true,
    canPublish: true,
    canSubscribe: true,
    canPublishData: true,
  });

  return { token: await token.toJwt(), url: wsUrl, expiresAt: input.expiresAt };
}
