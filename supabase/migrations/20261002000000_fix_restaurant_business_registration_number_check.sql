-- Allow the normalized and display formats used by restaurant identity resolution.
alter table public.restaurant_locations
  drop constraint restaurant_locations_business_registration_number_check,
  add constraint restaurant_locations_business_registration_number_check
    check (
      business_registration_number is null
      or business_registration_number ~ '^([0-9]{10}|[0-9]{3}-[0-9]{2}-[0-9]{5})$'
    );
