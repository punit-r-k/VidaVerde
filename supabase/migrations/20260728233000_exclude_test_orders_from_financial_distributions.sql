alter table orders
  add column if not exists is_test_order boolean not null default false;

comment on column orders.is_test_order is
  'True when the completed Stripe charge used the designated 4242 test-card suffix; excluded from financial distributions.';

create index if not exists orders_test_order_created_at_idx
  on orders (created_at desc)
  where is_test_order;
