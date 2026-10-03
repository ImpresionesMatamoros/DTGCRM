-- 0009 · Publication = where an item appears. Independent of lifecycle and presentation.
-- Outputs (CRM, general catalog without prices, USA/MX price lists) are queries, not copies.

create type inclusion_mode as enum ('ALL_MATCHING', 'EXPLICIT');

create table publication_profile (
  id               uuid primary key default gen_random_uuid(),
  key              text not null unique check (key ~ '^[a-z][a-z0-9_]*$'),
  name             text not null,
  inclusion_mode   inclusion_mode not null,
  allowed_statuses catalog_status[] not null check (cardinality(allowed_statuses) > 0),
  shows_prices     boolean not null,
  price_book_id    uuid references price_book (id),
  locale           text not null default 'es' check (locale in ('es', 'en'))
);

create table publication_assignment (
  profile_id      uuid not null references publication_profile (id) on delete cascade,
  item_id         uuid not null references catalog_item (id) on delete cascade,
  presentation_id uuid,
  is_included     boolean not null default true,
  sort            integer,
  primary key (profile_id, item_id),
  -- the presentation must belong to the same item
  foreign key (presentation_id, item_id) references presentation (id, item_id)
);

-- Membership rule (mirrors src/domain/publication.ts isPublished):
-- unset status is never published; status must be allowed; the item must be
-- available in the profile's market; ALL_MATCHING unless excluded, EXPLICIT only if included.
create view v_publication_membership as
select p.id as profile_id, p.key as profile_key, i.id as item_id, i.public_code, a.presentation_id
from publication_profile p
cross join catalog_item i
left join publication_assignment a on a.profile_id = p.id and a.item_id = i.id
left join price_book b on b.id = p.price_book_id
left join item_market_policy m on m.item_id = i.id and m.market_id = b.market_id
where i.status is not null
  and i.status = any (p.allowed_statuses)
  and coalesce(m.is_available, true)
  and case p.inclusion_mode
        when 'ALL_MATCHING' then coalesce(a.is_included, true)
        else coalesce(a.is_included, false)
      end;
