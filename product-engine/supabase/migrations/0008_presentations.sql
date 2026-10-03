-- 0008 · Presentation = how an item is shown (name, occasion, language, aliases).
-- Occasion is presentation, not product (BR-008).

create type presentation_status as enum ('DRAFT', 'READY');

create table presentation (
  id                uuid primary key default gen_random_uuid(),
  item_id           uuid not null references catalog_item (id) on delete cascade,
  locale            text not null check (locale in ('es', 'en')),
  occasion          text,
  display_name      text not null check (btrim(display_name) <> ''),
  short_description text,
  aliases           text[] not null default '{}',
  seo_keywords      text[] not null default '{}',
  is_default        boolean not null default false,
  status            presentation_status not null default 'DRAFT',
  unique (id, item_id) -- target for composite FK from publication_assignment
);

create unique index presentation_one_default_per_locale
  on presentation (item_id, locale) where is_default;
