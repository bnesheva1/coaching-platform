// Single toggle for the phone delivery option — "phone" already exists
// in the DB enum (services.delivery_type, bookings.delivery_type) and
// is always valid data regardless of this flag; this only controls
// whether the practitioner-facing UI offers it as a choice (the radio
// in ServicesSection.tsx) and whether clients can filter by it on
// Browse. Flip to false to hide it everywhere with no other code
// change — both call sites just read this one constant.
export const SHOW_PHONE_DELIVERY_OPTION = true;
