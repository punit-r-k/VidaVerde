-- Repair environments where the automatic-label columns were added without
-- replacing the original shipment status constraint. Label workers must be
-- able to claim pending work with the transient purchasing_label state.

alter table public.shipments
  drop constraint if exists shipments_status_check;

alter table public.shipments
  add constraint shipments_status_check
  check (status in (
    'pending_label',
    'purchasing_label',
    'label_purchased',
    'shipped',
    'delivered',
    'cancelled'
  )) not valid;

alter table public.shipments
  validate constraint shipments_status_check;
