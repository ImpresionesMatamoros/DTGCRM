import Link from 'next/link';
import { notFound } from 'next/navigation';
import { connection } from 'next/server';
import { z } from 'zod';
import { can } from '@/admin/permissions';
import { itemOptionsForEditor, itemSummary } from '@/db/admin/price-views';
import { getActor } from '../../../_server/actor';
import { adminPool } from '../../../_server/db';
import { DraftEditor } from '../[id]/draft-editor';

type Search = Promise<Record<string, string | string[] | undefined>>;
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default async function NewDraftPage({ searchParams }: { searchParams: Search }) {
  await connection();
  const params = await searchParams;
  const itemId = z.uuid().safeParse(first(params.itemId)).data;
  if (!itemId) notFound();
  const market = first(params.market) === 'MX' ? 'MX' : 'USA';
  const model = z
    .enum(['EXACT_QUANTITY_MATRIX', 'FIXED', 'PER_UNIT', 'TIERED', 'MEASURED'])
    .catch('EXACT_QUANTITY_MATRIX')
    .parse(first(params.model));
  const db = adminPool();
  const item = await itemSummary(db, itemId);
  if (!item) notFound();
  const editor = await itemOptionsForEditor(db, itemId);
  const actor = await getActor();
  const currency = market === 'MX' ? 'MXN' : 'USD';
  const startAt = new Date();
  startAt.setUTCSeconds(0, 0);
  return (
    <>
      <div className="crumbs">
        <Link href="/admin/pricing">Precios</Link> /{' '}
        <Link href={`/admin/pricing/${item.id}`}>{item.publicCode}</Link>
      </div>
      <h1 className="adm-h1">Nuevo borrador de precio</h1>
      <p className="adm-sub">
        <span className="mono">{item.publicCode}</span> · {item.name} · mercado {market} ({currency}
        ). Se crea como BORRADOR: no afecta ninguna cotización hasta que alguien con permiso lo
        autorice.
      </p>
      <form method="get" className="row panel">
        <input type="hidden" name="itemId" value={itemId} />
        <input type="hidden" name="market" value={market} />
        <label className="small">
          Modelo
          <select name="model" defaultValue={model}>
            <option value="EXACT_QUANTITY_MATRIX">Matriz de cantidades exactas</option>
            <option value="FIXED">Precio fijo</option>
            <option value="PER_UNIT">Por unidad</option>
            <option value="TIERED">Escalonado</option>
            <option value="MEASURED">Por medida</option>
          </select>
        </label>
        <button className="btn" type="submit">
          Cambiar modelo
        </button>
      </form>
      {!can(actor, 'price.edit') ? (
        <div className="notice warn">Necesitas un actor local con permiso price.edit.</div>
      ) : (
        <DraftEditor
          key={model + market}
          itemId={itemId}
          market={market}
          component="ITEM"
          model={model}
          currency={currency}
          options={editor.options}
          methods={editor.methods}
          initial={{
            validFrom: startAt.toISOString(),
            validTo: null,
            amount: null,
            rate: null,
            rateUnit: null,
            minCharge: null,
            minQuantity: null,
            maxQuantity: model === 'FIXED' ? 1 : null,
            breaks: [],
            conditions: [],
          }}
        />
      )}
    </>
  );
}
