// Which delivery types this deployment OFFERS — one deployment-scope config,
// not a boolean flag per type. The flags registry is boolean-only by contract
// (see lib/flags/registry.ts), and "which delivery modes exist" is a list a
// brand configures, so it lives here as a single env read instead: adding a
// third mode never needs a third flag, and a white-label brand sets one value.
//
// This is DISPLAY/OFFER config only. The DB keeps all three enum values, every
// existing service is untouched, and it is fully reversible by changing the env
// value — nothing is migrated.

export type DeliveryType = "online" | "in_person" | "phone";

// The full schema-level domain (matches the services_delivery_type_check
// constraint). "Offered" is a subset of this; validity is not.
export const DELIVERY_TYPES: readonly DeliveryType[] = ["online", "in_person", "phone"];

// The optional modes a deployment can switch on. "online" is deliberately NOT
// here — it's the non-negotiable core (the platform's video product; disabling
// it would strand every online service and every video booking), so it is
// ALWAYS offered and can't be turned off through this config.
const OPTIONAL_TYPES: readonly DeliveryType[] = ["in_person", "phone"];

// Parse ENABLED_DELIVERY_TYPES (comma-separated, e.g. "online,in_person").
// UNSET → online only: an unconfigured deployment gets the most restricted,
// safest state (degrade toward safe, like presence going stale reads as
// offline), so offering in-person or phone is a deliberate act, never something
// you get by forgetting. "online" is always included regardless of the value.
export function enabledDeliveryTypes(): Set<DeliveryType> {
  const enabled = new Set<DeliveryType>(["online"]);
  const raw = process.env.ENABLED_DELIVERY_TYPES;
  if (raw) {
    for (const part of raw.split(",")) {
      const value = part.trim().toLowerCase();
      if ((OPTIONAL_TYPES as readonly string[]).includes(value)) {
        enabled.add(value as DeliveryType);
      }
    }
  }
  return enabled;
}

export function isDeliveryTypeEnabled(type: DeliveryType): boolean {
  return enabledDeliveryTypes().has(type);
}

// A delivery-mode badge (the "Онлайн" / "На живо" pill on the profile) only
// carries information when the deployment offers a CHOICE of modes. With a
// single enabled mode — the default, online-only state, since in-person is
// deprioritised for now — every service is that one mode, so the badge is pure
// noise on every card. Hide it until a second mode (in_person/phone) is
// re-enabled, at which point online-vs-in-person is a real distinction again.
// Reversible through the same ENABLED_DELIVERY_TYPES env as everything else
// here; no delivery logic is removed, only the redundant badge is suppressed.
export function deliveryBadgesVisible(): boolean {
  return enabledDeliveryTypes().size > 1;
}
