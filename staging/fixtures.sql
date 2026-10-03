-- Execute only through scripts/staging/database.cjs seed after isolation preflight.
-- No real phones, emails, names, private files or cloned production rows.
do $$ begin
 if not exists(select 1 from staging_private.identity where environment='staging') then
  raise exception 'Not a staging database';
 end if;
end $$;
insert into public.clientes(id,nombre,empresa,telefono,email)
values ('10000000-0000-4000-8000-000000000001','CLIENTE FICTICIO — STAGING','Empresa de pruebas','','cliente@example.invalid')
on conflict(id) do nothing;
insert into public.tickets(id,cliente,cliente_id,responsable)
values ('20000000-0000-4000-8000-000000000001','CLIENTE FICTICIO — STAGING','10000000-0000-4000-8000-000000000001','')
on conflict(id) do nothing;
insert into public.productos(id,ticket_id,descripcion,cantidad,precio)
values ('30000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','Producto manual ficticio',1,45)
on conflict(id) do nothing;
-- Linked PE lines must be created by the STEP 10 picker using the real staging API.
-- This manual $45 fixture is NOT evidence of a PE master price or integration test.
