alter table checkout_shipping_quotes
  add column if not exists service_level text,
  add column if not exists expected_arrival_date date;

alter table checkout_shipping_quotes
  drop constraint if exists checkout_shipping_quotes_service_level_check;

alter table checkout_shipping_quotes
  add constraint checkout_shipping_quotes_service_level_check
  check (service_level is null or service_level in ('normal', 'expedited'));
