-- 0006 · Markets, price books, per-item market policy (persistent, ADR-0003) and FX.

create extension if not exists btree_gist;

create type currency_code as enum ('USD', 'MXN');
create type price_book_mode as enum ('MASTER', 'DERIVED');
create type pricing_mode as enum ('INHERIT', 'DERIVED', 'MANUAL', 'QUOTE_ONLY');

create table market (
  id               uuid primary key default gen_random_uuid(),
  code             text not null unique check (code in ('USA', 'MX')),
  name             text not null,
  default_currency currency_code not null
);

create table price_book (
  id                   uuid primary key default gen_random_uuid(),
  code                 text not null unique,
  market_id            uuid not null unique references market (id), -- one book per market (for now)
  currency             currency_code not null,
  mode                 price_book_mode not null,
  source_price_book_id uuid references price_book (id),
  default_factor       numeric(8, 4) check (default_factor > 0),
  check (
    (mode = 'MASTER' and source_price_book_id is null and default_factor is null)
    or (mode = 'DERIVED' and source_price_book_id is not null and default_factor is not null
        and source_price_book_id <> id)
  )
);

-- Persistent per-item market policy: e.g. MX · DERIVED · factor 0.50, or MX · MANUAL.
-- No row = INHERIT and available.
create table item_market_policy (
  item_id         uuid not null references catalog_item (id) on delete cascade,
  market_id       uuid not null references market (id),
  pricing_mode    pricing_mode not null default 'INHERIT',
  factor_override numeric(8, 4) check (factor_override > 0),
  is_available    boolean not null default true,
  primary key (item_id, market_id),
  check (factor_override is null or pricing_mode in ('INHERIT', 'DERIVED'))
);

-- A DERIVED policy only makes sense in a market whose book derives.
create function item_market_policy_guard() returns trigger
language plpgsql as $$
begin
  if new.pricing_mode = 'DERIVED'
     and (select mode from price_book where market_id = new.market_id) <> 'DERIVED' then
    raise exception 'DERIVED policy requires a DERIVED price book in market %', new.market_id;
  end if;
  return new;
end $$;

create trigger item_market_policy_guard before insert or update on item_market_policy
  for each row execute function item_market_policy_guard();

-- Versioned by validity window [valid_from, valid_to); no overlaps per key.
create table pricing_parameter (
  id         uuid primary key default gen_random_uuid(),
  key        text not null check (key ~ '^[a-z][a-z0-9_]*$'),
  value      numeric(14, 6) not null check (value > 0),
  valid_from timestamptz not null,
  valid_to   timestamptz,
  check (valid_to is null or valid_to > valid_from),
  exclude using gist (key with =, tstzrange(valid_from, valid_to, '[)') with &&)
);
