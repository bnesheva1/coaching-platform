import { getStripeClient } from "./client";
import { createServiceRoleClient } from "@/lib/supabase/serviceRole";

// v2 Accounts API, not v1 stripe.accounts.create({ type: "express" }) —
// Stripe rejects v1 account creation outright for this platform's
// account ("Stripe no longer recommends Accounts v1 for new Connect
// integrations"), confirmed live. dashboard: "express" + the recipient/
// application-responsibility config below is the v2 equivalent of a v1
// Express account for a marketplace using destination charges — same
// shape lib/payments/stripe/checkout.ts's transfer_data.destination
// already assumes. fees_collector/losses_collector: "application" is
// required here, not optional — v2 rejects losses_collector: "stripe"
// paired with destination charges, and it means the platform (not
// Stripe) bears liability for negative balances/dispute reversals on
// connected accounts, which is the correct trade-off for owning
// checkout as this platform does.
async function createConnectAccount(email: string): Promise<string> {
  const stripe = getStripeClient();
  const account = await stripe.v2.core.accounts.create({
    contact_email: email,
    dashboard: "express",
    identity: { country: "BG" },
    defaults: {
      responsibilities: {
        fees_collector: "application",
        losses_collector: "application",
      },
    },
    configuration: {
      recipient: {
        capabilities: {
          stripe_balance: {
            stripe_transfers: { requested: true },
          },
        },
      },
    },
  });
  return account.id;
}

// Reused by both the first-ever "Connect Stripe" click and every later
// "Continue setup" click — an existing stripe_connected_account_id is
// always reused rather than creating a second account for the same
// practitioner. The write happens immediately after Stripe confirms
// creation so a later click (even one made before this function's own
// caller finishes) finds the same id already stored, not a duplicate.
//
// Service-role throughout: this reads/writes stripe_connected_account_id,
// which practitioner_profiles' column grants deliberately exclude from
// any client-session access — every write to it goes through a trusted
// server path, never a client .update().
export async function ensureConnectAccount(practitionerId: string, email: string): Promise<string> {
  const supabase = createServiceRoleClient();

  const { data: profile } = await supabase
    .from("practitioner_profiles")
    .select("stripe_connected_account_id")
    .eq("id", practitionerId)
    .single();

  if (profile?.stripe_connected_account_id) {
    return profile.stripe_connected_account_id;
  }

  const accountId = await createConnectAccount(email);

  const { error } = await supabase
    .from("practitioner_profiles")
    .update({ stripe_connected_account_id: accountId })
    .eq("id", practitionerId);
  if (error) {
    // The Stripe account already exists at this point regardless — a
    // failed DB write here just means the next click's stripe_connected_
    // account_id lookup above will find nothing and create ANOTHER
    // account (an unused orphan on Stripe's side, harmless, no financial
    // risk). Logged loudly since it's the one case worth knowing about;
    // not retried here.
    console.error("ensureConnectAccount: Stripe account created but DB write failed", {
      practitionerId,
      accountId,
      error,
    });
  }

  return accountId;
}

// Single-use, short-lived by Stripe's own design — never stored,
// generated fresh on every call (including "Continue setup", which is
// just another call to this same function against the existing
// account). account_onboarding links work the same way regardless of
// which Accounts API version created the underlying account.
export async function createOnboardingLink(
  accountId: string,
  returnUrl: string,
  refreshUrl: string,
): Promise<string> {
  const stripe = getStripeClient();
  const link = await stripe.accountLinks.create({
    account: accountId,
    type: "account_onboarding",
    return_url: returnUrl,
    refresh_url: refreshUrl,
  });
  return link.url;
}

// Service-role read of the same column ensureConnectAccount itself
// reads — stripe_connected_account_id is excluded from the
// practitioner's own column grant (admin/system-only, same reasoning as
// every other Connect-status column), so this is the only way a server
// action can look it up. Unlike ensureConnectAccount, this never
// creates one — the manage-account action this backs is only ever
// reachable once an account already exists and is active.
export async function getConnectedAccountId(practitionerId: string): Promise<string | null> {
  const supabase = createServiceRoleClient();
  const { data } = await supabase
    .from("practitioner_profiles")
    .select("stripe_connected_account_id")
    .eq("id", practitionerId)
    .single();
  return data?.stripe_connected_account_id ?? null;
}

// Single-use, generated fresh on every call, never stored — same
// security shape as createOnboardingLink above. Deliberately NOT
// stripe.accountLinks.create({ type: "account_management" }): that
// type doesn't exist in this Stripe API version (only
// "account_onboarding"/"account_update"), and "account_update" is
// documented as only valid for accounts WITHOUT Stripe-hosted Dashboard
// access — the opposite of what createConnectAccount above sets up
// (dashboard: "express"). The correct mechanism for a dashboard:
// "express" account is a login link, which drops the practitioner
// straight into their own Stripe Express Dashboard to update bank
// details, tax info, and identity documents. Unlike account links, a
// login link takes no return_url — Stripe's Express Dashboard has its
// own built-in way back, not a per-request parameter.
export async function createExpressDashboardLoginLink(accountId: string): Promise<string> {
  const stripe = getStripeClient();
  const link = await stripe.accounts.createLoginLink(accountId);
  return link.url;
}

// Freeze or release a connected account's payouts to its bank by flipping its
// payout SCHEDULE (verified working on this platform's v2 Express/recipient
// accounts): "manual" holds funds in the account's Stripe balance indefinitely;
// "daily" resumes the normal schedule, at which point the accumulated balance
// pays out. Destination charges are untouched, so bookings and payments keep
// working while frozen — money accumulates rather than failing, exactly the
// intended "freeze payouts" behaviour. Used by the admin freeze-payouts control.
export async function setPayoutsHold(accountId: string, held: boolean): Promise<void> {
  const stripe = getStripeClient();
  await stripe.accounts.update(accountId, {
    settings: { payouts: { schedule: held ? { interval: "manual" } : { interval: "daily" } } },
  });
}

// The v2 (thin) Connect events the account-readiness flow depends on. The thin
// branch of the webhook route handles ANY account event generically (it just
// re-fetches the account), so there's no per-type switch to derive from — this
// is the single source the health config check reads to confirm a v2 event
// destination is subscribed to the account events. A missing one means
// practitioners never flip to transfers-active (and so never become bookable on
// the commission model), silently.
export const REQUIRED_STRIPE_V2_EVENTS: readonly string[] = [
  "v2.core.account[configuration.recipient].capability_status_updated",
  "v2.core.account.updated",
];

// Called from the webhook route for both v2.core.account.updated and
// v2.core.account[configuration.recipient].capability_status_updated —
// deliberately re-fetches the account's current state rather than
// trusting whatever shape arrived in the event payload (v2 events are
// "thin": the payload is mostly just a reference, not the full object).
// A single authoritative retrieve + one field to persist is simpler and
// more robust than branching on event/payload shape.
export async function handleAccountUpdated(accountId: string): Promise<void> {
  const stripe = getStripeClient();
  const account = await stripe.v2.core.accounts.retrieve(accountId, {
    include: ["configuration.recipient"],
  });

  const transfersActive =
    account.configuration?.recipient?.capabilities?.stripe_balance?.stripe_transfers?.status === "active";

  const supabase = createServiceRoleClient();
  const { error } = await supabase
    .from("practitioner_profiles")
    .update({ stripe_connect_transfers_active: transfersActive })
    .eq("stripe_connected_account_id", accountId);

  if (error) {
    console.error("handleAccountUpdated: failed to update practitioner_profiles", {
      accountId,
      error,
    });
  }
}
