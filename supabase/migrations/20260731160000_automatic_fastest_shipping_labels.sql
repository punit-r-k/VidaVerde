alter table shipments
  add column if not exists label_purchase_started_at timestamptz,
  add column if not exists label_purchase_error text;

alter table shipments
  drop constraint if exists shipments_status_check;

alter table shipments
  add constraint shipments_status_check
  check (status in (
    'pending_label',
    'purchasing_label',
    'label_purchased',
    'shipped',
    'delivered',
    'cancelled'
  ));
