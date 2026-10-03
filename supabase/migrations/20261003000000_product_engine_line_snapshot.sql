-- STEP 10 · CRM ↔ DTG Product Engine: immutable per-line transaction snapshot.
--
-- Additive and backward compatible:
--   * every new column is nullable except line_source (constant default 'MANUAL'),
--     so every existing row is valid as-is and needs NO backfill;
--   * `productos` stays the only line table (no parallel "v2" universe);
--   * workspace_patch_record is NOT widened: descripcion/cantidad/precio keep their
--     field-level compare-and-set; snapshot columns can only change through the two
--     RPCs below (a trigger enforces it), so a generic edit can never rewrite a snapshot.
--   * the CRM never reads the Product Engine database; it stores what the versioned
--     /api/v1 contract returned at the moment the line was priced.
--
-- Pre-apply note: the one non-purely-additive step is the guarded widening of
-- productos.precio (see the DO block). It runs only if the column currently has a fixed
-- scale below 4; widening numeric(p,s) -> numeric never loses data.

-- ---------------------------------------------------------------- columns
alter table public.productos
  add column if not exists line_source text not null default 'MANUAL',
  add column if not exists pe_catalog_item_id uuid,
  add column if not exists pe_public_code text,
  add column if not exists pe_canonical_name_snapshot text,
  add column if not exists pe_customer_description_snapshot text,
  add column if not exists pe_configuration_snapshot jsonb,
  add column if not exists pe_quantity numeric,
  add column if not exists pe_market text,
  add column if not exists pe_pricing_status_snapshot text,
  add column if not exists pe_total_amount numeric,
  add column if not exists pe_currency text,
  add column if not exists pe_catalog_revision integer,
  add column if not exists pe_pricing_revision integer,
  add column if not exists pe_effective_at timestamptz,
  add column if not exists pe_reason_code text,
  add column if not exists pe_contract_version text,
  add column if not exists pe_priced_at timestamptz,
  add column if not exists pe_detached_at timestamptz,
  add column if not exists pe_detached_by uuid,
  add column if not exists pe_detach_reason text,
  add column if not exists pe_detached_snapshot jsonb;

-- Exact unit price (total / quantity) must be storable: widen only when needed.
do $$
declare s integer;
begin
  select numeric_scale into s from information_schema.columns
   where table_schema = 'public' and table_name = 'productos' and column_name = 'precio' and data_type = 'numeric';
  if s is not null and s < 4 then
    alter table public.productos alter column precio type numeric;
  end if;
end $$;

-- ---------------------------------------------------------------- integrity
alter table public.productos drop constraint if exists productos_line_source_chk;
alter table public.productos add constraint productos_line_source_chk
  check (line_source in ('MANUAL', 'PRODUCT_ENGINE'));

alter table public.productos drop constraint if exists productos_pe_snapshot_chk;
alter table public.productos add constraint productos_pe_snapshot_chk check (
  case line_source
    when 'PRODUCT_ENGINE' then
      pe_catalog_item_id is not null
      and pe_public_code ~ '^DTG-[0-9]{5,}$'
      and pe_canonical_name_snapshot is not null and btrim(pe_canonical_name_snapshot) <> ''
      and pe_configuration_snapshot is not null and jsonb_typeof(pe_configuration_snapshot) = 'object'
      and pe_quantity is not null and pe_quantity > 0
      and pe_market in ('USA', 'MX')
      -- INVALID is never saved as a valid line
      and pe_pricing_status_snapshot in ('RESOLVED', 'QUOTE_ONLY', 'AMBIGUOUS')
      and pe_effective_at is not null and pe_priced_at is not null
      and pe_contract_version is not null
      and pe_catalog_revision is not null and pe_pricing_revision is not null
      and (
        (pe_pricing_status_snapshot = 'RESOLVED' and pe_total_amount is not null and pe_total_amount >= 0 and pe_currency is not null)
        or
        (pe_pricing_status_snapshot <> 'RESOLVED' and pe_total_amount is null and pe_reason_code is not null)
      )
    else
      pe_catalog_item_id is null and pe_public_code is null and pe_configuration_snapshot is null
  end
);

create index if not exists productos_pe_catalog_item_idx
  on public.productos (pe_catalog_item_id) where pe_catalog_item_id is not null;

-- ------------------------------------------------- snapshot is write-protected
-- Snapshot columns change only inside the RPCs below (transaction-local flag).
create or replace function public.productos_pe_snapshot_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if coalesce(current_setting('dtg.pe_snapshot_write', true), '') <> 'on' and (
       new.line_source is distinct from old.line_source
    or new.pe_catalog_item_id is distinct from old.pe_catalog_item_id
    or new.pe_public_code is distinct from old.pe_public_code
    or new.pe_canonical_name_snapshot is distinct from old.pe_canonical_name_snapshot
    or new.pe_customer_description_snapshot is distinct from old.pe_customer_description_snapshot
    or new.pe_configuration_snapshot is distinct from old.pe_configuration_snapshot
    or new.pe_quantity is distinct from old.pe_quantity
    or new.pe_market is distinct from old.pe_market
    or new.pe_pricing_status_snapshot is distinct from old.pe_pricing_status_snapshot
    or new.pe_total_amount is distinct from old.pe_total_amount
    or new.pe_currency is distinct from old.pe_currency
    or new.pe_catalog_revision is distinct from old.pe_catalog_revision
    or new.pe_pricing_revision is distinct from old.pe_pricing_revision
    or new.pe_effective_at is distinct from old.pe_effective_at
    or new.pe_reason_code is distinct from old.pe_reason_code
    or new.pe_contract_version is distinct from old.pe_contract_version
    or new.pe_priced_at is distinct from old.pe_priced_at
    or new.pe_detached_at is distinct from old.pe_detached_at
    or new.pe_detached_by is distinct from old.pe_detached_by
    or new.pe_detach_reason is distinct from old.pe_detach_reason
    or new.pe_detached_snapshot is distinct from old.pe_detached_snapshot
  ) then
    raise exception 'PE_SNAPSHOT_IMMUTABLE: el precio guardado de este producto solo cambia con "Actualizar precio" o "Desvincular".'
      using errcode = 'P0001';
  end if;
  return new;
end $$;

drop trigger if exists productos_pe_snapshot_guard on public.productos;
create trigger productos_pe_snapshot_guard before update on public.productos
  for each row execute function public.productos_pe_snapshot_guard();

-- ------------------------------------------------------- explicit re-price RPC
-- Explicit user action only. p_expected carries the pe_priced_at the user saw; if
-- someone else re-priced or detached meanwhile the call fails with EDIT_CONFLICT.
-- p_change: { snapshot: {pe_* columns}, cantidad, precio, descripcion? }
create or replace function public.product_engine_reprice_line(p_id uuid, p_expected_priced_at timestamptz, p_change jsonb)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare cur public.productos; snap jsonb; rec public.productos; result_row jsonb;
begin
  if auth.uid() is null or not public.is_active_member() then raise exception 'Authentication required'; end if;
  if jsonb_typeof(p_change) is distinct from 'object' or jsonb_typeof(p_change->'snapshot') is distinct from 'object' then
    raise exception 'Invalid change';
  end if;
  select * into cur from public.productos where id = p_id for update;
  if not found then raise exception 'Record unavailable'; end if;
  if cur.line_source <> 'PRODUCT_ENGINE' then
    raise exception 'NOT_LINKED: esta línea ya no está vinculada al catálogo.' using errcode = 'P0001';
  end if;
  if cur.pe_priced_at is distinct from p_expected_priced_at then
    raise exception using errcode = '40001',
      message = 'EDIT_CONFLICT: Otra persona cambió el precio de este producto. Revisa el valor actual antes de guardar.',
      detail = to_jsonb(cur)::text;
  end if;
  snap := p_change->'snapshot';
  rec := jsonb_populate_record(cur, snap);
  if rec.pe_catalog_item_id is distinct from cur.pe_catalog_item_id then
    raise exception 'DIFFERENT_ITEM: actualizar el precio no puede cambiar el producto del catálogo.' using errcode = 'P0001';
  end if;
  if (p_change ? 'cantidad' and ((p_change->>'cantidad')::numeric) <= 0)
     or (p_change ? 'precio' and p_change->>'precio' is not null and ((p_change->>'precio')::numeric) < 0) then
    raise exception 'Invalid quantity or price';
  end if;
  perform set_config('dtg.pe_snapshot_write', 'on', true);
  update public.productos t set
    pe_catalog_item_id = rec.pe_catalog_item_id, pe_public_code = rec.pe_public_code,
    pe_canonical_name_snapshot = rec.pe_canonical_name_snapshot,
    pe_customer_description_snapshot = rec.pe_customer_description_snapshot,
    pe_configuration_snapshot = rec.pe_configuration_snapshot, pe_quantity = rec.pe_quantity,
    pe_market = rec.pe_market, pe_pricing_status_snapshot = rec.pe_pricing_status_snapshot,
    pe_total_amount = rec.pe_total_amount, pe_currency = rec.pe_currency,
    pe_catalog_revision = rec.pe_catalog_revision, pe_pricing_revision = rec.pe_pricing_revision,
    pe_effective_at = rec.pe_effective_at, pe_reason_code = rec.pe_reason_code,
    pe_contract_version = rec.pe_contract_version, pe_priced_at = rec.pe_priced_at,
    cantidad = coalesce((p_change->>'cantidad')::numeric, t.cantidad),
    precio = case when p_change ? 'precio' then (p_change->>'precio')::numeric else t.precio end,
    descripcion = coalesce(p_change->>'descripcion', t.descripcion)
  where t.id = p_id returning to_jsonb(t) into result_row;
  perform set_config('dtg.pe_snapshot_write', 'off', true);
  return result_row;
end $$;

-- ----------------------------------------------------------------- detach RPC
-- Back to a plain manual line. The previous snapshot is kept as audit metadata.
create or replace function public.product_engine_detach_line(p_id uuid, p_expected_priced_at timestamptz, p_reason text default null)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare cur public.productos; result_row jsonb; old_snap jsonb;
begin
  if auth.uid() is null or not public.is_active_member() then raise exception 'Authentication required'; end if;
  select * into cur from public.productos where id = p_id for update;
  if not found then raise exception 'Record unavailable'; end if;
  if cur.line_source <> 'PRODUCT_ENGINE' then
    raise exception 'NOT_LINKED: esta línea ya no está vinculada al catálogo.' using errcode = 'P0001';
  end if;
  if cur.pe_priced_at is distinct from p_expected_priced_at then
    raise exception using errcode = '40001',
      message = 'EDIT_CONFLICT: Otra persona cambió el precio de este producto. Revisa el valor actual antes de guardar.',
      detail = to_jsonb(cur)::text;
  end if;
  old_snap := jsonb_strip_nulls(jsonb_build_object(
    'pe_catalog_item_id', cur.pe_catalog_item_id, 'pe_public_code', cur.pe_public_code,
    'pe_canonical_name_snapshot', cur.pe_canonical_name_snapshot,
    'pe_customer_description_snapshot', cur.pe_customer_description_snapshot,
    'pe_configuration_snapshot', cur.pe_configuration_snapshot, 'pe_quantity', cur.pe_quantity,
    'pe_market', cur.pe_market, 'pe_pricing_status_snapshot', cur.pe_pricing_status_snapshot,
    'pe_total_amount', cur.pe_total_amount, 'pe_currency', cur.pe_currency,
    'pe_catalog_revision', cur.pe_catalog_revision, 'pe_pricing_revision', cur.pe_pricing_revision,
    'pe_effective_at', cur.pe_effective_at, 'pe_reason_code', cur.pe_reason_code,
    'pe_contract_version', cur.pe_contract_version, 'pe_priced_at', cur.pe_priced_at));
  perform set_config('dtg.pe_snapshot_write', 'on', true);
  update public.productos t set
    line_source = 'MANUAL',
    pe_catalog_item_id = null, pe_public_code = null, pe_canonical_name_snapshot = null,
    pe_customer_description_snapshot = null, pe_configuration_snapshot = null, pe_quantity = null,
    pe_market = null, pe_pricing_status_snapshot = null, pe_total_amount = null, pe_currency = null,
    pe_catalog_revision = null, pe_pricing_revision = null, pe_effective_at = null, pe_reason_code = null,
    pe_contract_version = null, pe_priced_at = null,
    pe_detached_at = now(), pe_detached_by = auth.uid(),
    pe_detach_reason = coalesce(nullif(btrim(p_reason), ''), 'user_detached'),
    pe_detached_snapshot = old_snap
  where t.id = p_id returning to_jsonb(t) into result_row;
  perform set_config('dtg.pe_snapshot_write', 'off', true);
  return result_row;
end $$;

revoke all on function public.product_engine_reprice_line(uuid, timestamptz, jsonb) from public, anon;
revoke all on function public.product_engine_detach_line(uuid, timestamptz, text) from public, anon;
grant execute on function public.product_engine_reprice_line(uuid, timestamptz, jsonb) to authenticated;
grant execute on function public.product_engine_detach_line(uuid, timestamptz, text) to authenticated;
