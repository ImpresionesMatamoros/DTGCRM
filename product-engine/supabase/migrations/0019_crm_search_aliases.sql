-- 0019 · STEP 10 — search vocabulary for the CRM picker (aliases only).
-- Data-only and idempotent. For databases whose items already exist (seeded/imported before
-- this migration); fresh rebuilds get the same aliases from the seed (data/dev-slice).
-- Aliases never change canonical names, statuses or prices. Presentations stay DRAFT.
do $$
declare
  r record;
begin
  for r in
    select * from (values
      ('Tarjeta de presentación Tradicional', array['tarjeta','tarjetas','tarjeta de negocio'], 'Business card', array['Business card','business cards','traditional business card']),
      ('Tarjeta de presentación Premium / Gloss', array['tarjeta','tarjetas','tarjeta de negocio'], 'Premium business card', array['Premium business card','business card','business cards','gloss business card']),
      ('Flyers', array['volante','volantes'], 'Flyer', array['Flyer','flyers']),
      ('Imanes para vehículo — par 2 × 1 ft', array['imán','iman','imanes'], 'Vehicle magnet', array['Vehicle magnet','car magnet','magnets'])
    ) v(canonical_name, es_aliases, en_name, en_aliases)
  loop
    declare iid uuid;
    begin
      select id into iid from catalog_item where canonical_name = r.canonical_name;
      if iid is null then continue; end if;
      update presentation p
         set aliases = (select array_agg(distinct a) from unnest(p.aliases || r.es_aliases) a)
       where p.item_id = iid and p.locale = 'es' and p.is_default;
      if not exists (select 1 from presentation where item_id = iid and locale = 'en') then
        insert into presentation (item_id, locale, display_name, aliases, is_default, status)
        values (iid, 'en', r.en_name, r.en_aliases, true, 'DRAFT');
      end if;
    end;
  end loop;
end $$;
