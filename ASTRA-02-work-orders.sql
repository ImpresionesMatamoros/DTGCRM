-- Ordenes de trabajo: un entregable por orden; las acciones siguen en tareas.
-- Requiere las columnas area/tipo_operacion ya existentes en tareas.
-- Las políticas permisivas antiguas (OR) anulaban la privacidad de tickets.
-- Las políticas *_active_members / tickets_* ya existen y cubren el acceso.
drop policy if exists "authenticated read/write tickets" on public.tickets;
drop policy if exists "authenticated read/write tareas" on public.tareas;
drop policy if exists "authenticated read/write productos" on public.productos;
drop policy if exists "authenticated read/write bitacora" on public.bitacora;
drop policy if exists "authenticated read/write pagos" on public.pagos;
drop policy if exists "authenticated read/write documentos" on public.documentos;
create unique index if not exists productos_ticket_id_id_uq on public.productos(ticket_id,id);

create table if not exists public.work_orders (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.tickets(id) on delete cascade,
  product_id uuid,
  title text not null check (length(btrim(title)) between 1 and 160),
  instructions text not null default '',
  quantity_override numeric check (quantity_override is null or quantity_override > 0),
  created_at timestamptz not null default now(),
  unique(ticket_id,id),
  foreign key(ticket_id,product_id) references public.productos(ticket_id,id) on delete set null (product_id)
);
create index if not exists work_orders_ticket_id_idx on public.work_orders(ticket_id);
alter table public.work_orders enable row level security;
grant select,insert,update,delete on public.work_orders to authenticated;
create policy work_orders_read on public.work_orders for select to authenticated
  using (public.is_active_member() and public.ticket_is_visible_to_me(ticket_id));
create policy work_orders_insert on public.work_orders for insert to authenticated
  with check (public.is_active_member() and public.ticket_is_visible_to_me(ticket_id));
create policy work_orders_update on public.work_orders for update to authenticated
  using (public.is_active_member() and public.ticket_is_visible_to_me(ticket_id))
  with check (public.is_active_member() and public.ticket_is_visible_to_me(ticket_id));
create policy work_orders_delete on public.work_orders for delete to authenticated
  using (public.is_active_member() and public.ticket_is_visible_to_me(ticket_id));

alter table public.tareas add column if not exists work_order_id uuid;
alter table public.tareas add column if not exists action_code text;
alter table public.tareas add column if not exists action_path text;
create index if not exists tareas_work_order_id_idx on public.tareas(work_order_id);
alter table public.tareas add constraint tareas_work_order_ticket_fkey
  foreign key(ticket_id,work_order_id) references public.work_orders(ticket_id,id) on delete set null (work_order_id);
