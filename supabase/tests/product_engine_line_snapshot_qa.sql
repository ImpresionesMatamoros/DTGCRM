-- STEP 10 QA. Run against a database where all migrations (incl. 20261003000000) are applied.
-- Everything is rolled back. Requires at least one auth user.
begin;
create temporary table pesqa as
  select (select id from auth.users order by created_at limit 1) uid, gen_random_uuid() ticket,
         gen_random_uuid() manual_line, gen_random_uuid() pe_line, gen_random_uuid() item;
grant select on pesqa to authenticated;
insert into public.tickets(id,cliente,responsable) select ticket,'QA rollback only','Inicial' from pesqa;
-- (I) a legacy-shaped insert (5 columns) is still valid: no backfill, defaults to MANUAL.
insert into public.productos(id,ticket_id,descripcion,cantidad,precio) select manual_line,ticket,'Manual libre',3,10.3333 from pesqa;
do $$declare x record; r record; begin select * into x from pesqa;
  select * into r from public.productos where id = x.manual_line;
  assert r.line_source = 'MANUAL' and r.pe_catalog_item_id is null and r.pe_configuration_snapshot is null;
  assert r.precio = 10.3333, 'precio keeps 4 decimals (exact unit price)';
end $$;

-- CHECK constraints: a PRODUCT_ENGINE line must be complete; INVALID is never a saved status.
do $$declare x record; begin select * into x from pesqa;
  begin insert into public.productos(ticket_id,descripcion,cantidad,line_source) values (x.ticket,'x',1,'PRODUCT_ENGINE'); raise exception 'incomplete snapshot accepted';
  exception when check_violation then null; end;
  begin insert into public.productos(ticket_id,descripcion,cantidad,line_source,pe_catalog_item_id,pe_public_code,pe_canonical_name_snapshot,pe_configuration_snapshot,pe_quantity,pe_market,pe_pricing_status_snapshot,pe_effective_at,pe_priced_at,pe_contract_version,pe_catalog_revision,pe_pricing_revision,pe_reason_code)
        values (x.ticket,'x',1,'PRODUCT_ENGINE',x.item,'DTG-00002','n','{}',1,'USA','INVALID',now(),now(),'1',1,1,'X'); raise exception 'INVALID status accepted';
  exception when check_violation then null; end;
  begin insert into public.productos(ticket_id,descripcion,cantidad,pe_public_code) values (x.ticket,'x',1,'DTG-00002'); raise exception 'manual line with PE code accepted';
  exception when check_violation then null; end;
end $$;

insert into public.productos(id,ticket_id,descripcion,cantidad,precio,line_source,pe_catalog_item_id,pe_public_code,pe_canonical_name_snapshot,pe_customer_description_snapshot,pe_configuration_snapshot,pe_quantity,pe_market,pe_pricing_status_snapshot,pe_total_amount,pe_currency,pe_catalog_revision,pe_pricing_revision,pe_effective_at,pe_priced_at,pe_contract_version)
select pe_line,ticket,'Tarjeta Premium · 2 caras',500,0.24,'PRODUCT_ENGINE',item,'DTG-00002','Tarjeta de presentación Premium / Gloss','Tarjeta · 2 caras','{"selections":[{"option_key":"caras","value_codes":["2"]}]}',500,'USA','RESOLVED',120.00,'USD',3,5,'2026-10-01T12:00:00Z','2026-10-01T12:00:01Z','1' from pesqa;

grant select on pesqa to authenticated;
select set_config('request.jwt.claim.sub',(select uid::text from pesqa),true);
set local role authenticated;
do $$declare x record; r jsonb; ts timestamptz; begin select * into x from pesqa;
  -- Generic edits (amount adjustments stay in the CRM) keep working and never touch the snapshot.
  r := public.workspace_patch_record('productos',x.pe_line,'{"precio":0.2}','{"precio":0.24}'); assert (r->>'precio')::numeric = 0.2;
  assert r->>'pe_pricing_status_snapshot' = 'RESOLVED' and (r->>'pe_total_amount')::numeric = 120.00;
  -- ...but snapshot columns are not editable through the generic RPC (whitelist) nor by plain UPDATE (trigger).
  begin perform public.workspace_patch_record('productos',x.pe_line,'{"pe_total_amount":1}','{"pe_total_amount":120}'); raise exception 'snapshot patched via generic rpc';
  exception when raise_exception then assert sqlerrm like '%Invalid field%'; end;
  begin update public.productos set pe_total_amount = 1 where id = x.pe_line; raise exception 'snapshot updated directly';
  exception when sqlstate 'P0001' then assert sqlerrm like 'PE_SNAPSHOT_IMMUTABLE%'; end;
  begin update public.productos set line_source = 'MANUAL' where id = x.pe_line; raise exception 'detached directly';
  exception when sqlstate 'P0001' then null; end;
  -- Plain edits on other columns are untouched by the guard.
  update public.productos set descripcion = 'Editado' where id = x.pe_line;
end $$;

-- Explicit re-price: stale expectation fails, fresh one succeeds, item cannot change.
do $$declare x record; r jsonb; seen timestamptz; begin select * into x from pesqa;
  select pe_priced_at into seen from public.productos where id = x.pe_line;
  begin perform public.product_engine_reprice_line(x.pe_line, seen - interval '1 minute', '{"snapshot":{},"cantidad":500}'); raise exception 'stale reprice accepted';
  exception when serialization_failure then null; end;
  begin perform public.product_engine_reprice_line(x.pe_line, seen, jsonb_build_object('snapshot', jsonb_build_object('pe_catalog_item_id', gen_random_uuid()))); raise exception 'item changed';
  exception when sqlstate 'P0001' then assert sqlerrm like 'DIFFERENT_ITEM%'; end;
  r := public.product_engine_reprice_line(x.pe_line, seen, jsonb_build_object('cantidad',500,'precio',0.25,
        'snapshot', jsonb_build_object('pe_total_amount',125.00,'pe_pricing_revision',6,'pe_effective_at','2026-10-05T00:00:00Z','pe_priced_at','2026-10-05T00:00:01Z')));
  assert (r->>'pe_total_amount')::numeric = 125.00 and (r->>'pe_pricing_revision')::int = 6 and (r->>'precio')::numeric = 0.25;
  -- the same stale token now conflicts (someone else already re-priced)
  begin perform public.product_engine_reprice_line(x.pe_line, seen, '{"snapshot":{}}'); raise exception 'second stale reprice accepted';
  exception when serialization_failure then null; end;
  -- QUOTE_ONLY re-price: no total allowed, price pending.
  select pe_priced_at into seen from public.productos where id = x.pe_line;
  r := public.product_engine_reprice_line(x.pe_line, seen, jsonb_build_object('cantidad',750,'precio',null,
        'snapshot', jsonb_build_object('pe_quantity',750,'pe_pricing_status_snapshot','QUOTE_ONLY','pe_total_amount',null,'pe_currency',null,'pe_reason_code','NO_TARIFF','pe_priced_at','2026-10-06T00:00:00Z')));
  assert r->>'pe_pricing_status_snapshot' = 'QUOTE_ONLY' and r->'precio' = 'null'::jsonb and r->'pe_total_amount' = 'null'::jsonb;
  -- Detach keeps an audit trail and turns the line into a normal manual line.
  select pe_priced_at into seen from public.productos where id = x.pe_line;
  r := public.product_engine_detach_line(x.pe_line, seen, 'cliente pidió precio propio');
  assert r->>'line_source' = 'MANUAL' and r->'pe_public_code' = 'null'::jsonb and r->>'pe_detach_reason' = 'cliente pidió precio propio';
  assert r->'pe_detached_snapshot'->>'pe_public_code' = 'DTG-00002' and (r->>'pe_detached_by')::uuid = x.uid and r->>'pe_detached_at' is not null;
  begin perform public.product_engine_detach_line(x.pe_line, seen, null); raise exception 'double detach accepted';
  exception when sqlstate 'P0001' then assert sqlerrm like 'NOT_LINKED%'; end;
  begin perform public.product_engine_reprice_line(x.manual_line, null, '{"snapshot":{}}'); raise exception 'manual line re-priced';
  exception when sqlstate 'P0001' then assert sqlerrm like 'NOT_LINKED%'; end;
  -- Manual lines keep full generic-edit behaviour.
  r := public.workspace_patch_record('productos',x.manual_line,'{"precio":11}','{"precio":10.3333}'); assert (r->>'precio')::numeric = 11;
end $$;

-- Privileges: anon cannot call the new RPCs.
reset role;
do $$ begin
  assert not has_function_privilege('anon','public.product_engine_reprice_line(uuid,timestamptz,jsonb)','execute');
  assert not has_function_privilege('anon','public.product_engine_detach_line(uuid,timestamptz,text)','execute');
  assert has_function_privilege('authenticated','public.product_engine_reprice_line(uuid,timestamptz,jsonb)','execute');
end $$;
rollback;
