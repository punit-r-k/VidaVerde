-- Preserve the real EasyPost and packaging costs while recording the subsidy
-- used to keep a one-unit standard-shipping cart at $19.98 or less.

alter table public.checkout_shipping_quotes
  add column if not exists discount_cents integer not null default 0;

alter table public.checkout_shipping_quotes
  drop constraint if exists checkout_shipping_quotes_discount_nonnegative_check,
  drop constraint if exists checkout_shipping_quotes_discount_bounded_check,
  drop constraint if exists checkout_shipping_quotes_charge_math_check;

-- Earlier versions used unnamed checks. Remove only the two definitions that
-- conflict with discounted, non-dollar customer shipping charges.
do $$
declare
  v_constraint record;
  v_definition text;
begin
  for v_constraint in
    select oid, conname
      from pg_constraint
     where conrelid = 'public.checkout_shipping_quotes'::regclass
       and contype = 'c'
  loop
    v_definition := pg_get_constraintdef(v_constraint.oid);

    if (
      v_definition ilike '%charged_shipping_cents%'
      and v_definition ilike '%unrounded_cents%'
      and v_definition ilike '%rounding_cents%'
    ) or (
      v_definition ilike '%charged_shipping_cents%'
      and v_definition ilike '%mod(%'
    ) then
      execute format(
        'alter table public.checkout_shipping_quotes drop constraint %I',
        v_constraint.conname
      );
    end if;
  end loop;
end
$$;

alter table public.checkout_shipping_quotes
  add constraint checkout_shipping_quotes_discount_nonnegative_check
    check (discount_cents >= 0) not valid,
  add constraint checkout_shipping_quotes_discount_bounded_check
    check (discount_cents <= unrounded_cents + rounding_cents) not valid,
  add constraint checkout_shipping_quotes_charge_math_check
    check (
      charged_shipping_cents =
        unrounded_cents + rounding_cents - discount_cents
    ) not valid;

alter table public.checkout_shipping_quotes
  validate constraint checkout_shipping_quotes_discount_nonnegative_check,
  validate constraint checkout_shipping_quotes_discount_bounded_check,
  validate constraint checkout_shipping_quotes_charge_math_check;
