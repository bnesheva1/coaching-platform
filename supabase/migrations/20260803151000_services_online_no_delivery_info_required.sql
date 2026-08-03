-- Simplification pass: the meeting-link/joining-instructions field is
-- no longer collected in the create/edit form for online services —
-- LiveKit will auto-generate a per-booking link instead of a
-- practitioner-entered one (meeting_link, reserved since the phone-
-- delivery migration, is where a future custom-link override will
-- live; this migration doesn't touch it). in_person still requires
-- delivery_info (an address), phone still requires phone_number.
-- Online now needs neither — dropping that branch of
-- services_delivery_contact_required_if_active entirely rather than
-- requiring an empty string, so an active online service with no
-- delivery_info at all (the new normal) still satisfies the constraint.

begin;

alter table public.services drop constraint services_delivery_contact_required_if_active;

alter table public.services
  add constraint services_delivery_contact_required_if_active
  check (
    not is_active
    or delivery_type = 'online'
    or (delivery_type = 'in_person' and delivery_info is not null and delivery_info <> '')
    or (delivery_type = 'phone' and phone_number is not null and phone_number <> '')
  )
  not valid;

commit;
