/**
 * Test hooks used ONLY by the STEP 10 cross-system harness to change Product Engine data the
 * way an operator would (through the real admin functions), so the CRM scenarios can prove that
 * saved lines do not move.   usage: tsx tools/step10/pe-hooks.ts <revise-price|retire|restore>
 */
import { Pool } from 'pg';
import { itemId } from '../../data/dev-slice';
import {
  authorizePriceRevision,
  cloneAuthorizedToDraft,
  updateDraftPriceDefinition,
} from '../../src/db/admin/price-admin';
import { setActorContext } from '../../src/db/admin/tx';

const CARD = itemId('tarjeta_premium');
const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL required');
const pool = new Pool({ connectionString: url });

async function revisePrice(amount500: string) {
  const c = await pool.connect();
  try {
    await c.query('begin');
    await setActorContext(c, 'step10-harness', 'test');
    const at = new Date();
    const ctx = {
      actor: 'step10-harness',
      now: at,
      reason: 'STEP 10 harness price revision',
    };
    const head = (
      await c.query(
        `select d.id from price_definition d where d.item_id = $1 and d.status = 'AUTHORIZED'
           and exists (select 1 from price_condition pc join option_value v on v.id = pc.option_value_id
                        where pc.price_definition_id = d.id and v.code = '2')`,
        [CARD],
      )
    ).rows[0].id as string;
    // A revision may not rewrite the past: it takes effect from "now" (see RETROACTIVE_SUPERSESSION).
    const validFrom = at.toISOString();
    const clone = await cloneAuthorizedToDraft(c, head, ctx, { validFrom });
    if (!clone.ok) throw new Error(JSON.stringify(clone));
    const breaks = (
      await c.query(
        'select quantity, amount, amount_basis from price_break where price_definition_id = $1 order by quantity',
        [clone.definitionId],
      )
    ).rows.map((b) => ({
      quantity: Number(b.quantity),
      amount: Number(b.quantity) === 500 ? amount500 : Number(b.amount).toFixed(2),
      amountBasis: b.amount_basis as 'TOTAL' | 'UNIT',
    }));
    const upd = await updateDraftPriceDefinition(
      c,
      {
        definitionId: clone.definitionId,
        validFrom,
        conditions: [{ kind: 'OPTION_VALUE', optionKey: 'caras', valueCode: '2' }],
        breaks,
      },
      ctx,
    );
    if (!upd.ok) throw new Error(JSON.stringify(upd));
    const auth = await authorizePriceRevision(c, clone.definitionId, ctx);
    if (!auth.ok) throw new Error(JSON.stringify(auth));
    await c.query('commit');
  } catch (e) {
    await c.query('rollback');
    throw e;
  } finally {
    c.release();
  }
}

async function main() {
  const cmd = process.argv[2];
  if (cmd === 'revise-price') await revisePrice(process.argv[3] ?? '130.00');
  else if (cmd === 'retire')
    await pool.query("update catalog_item set status = 'RETIRED' where id = $1", [CARD]);
  else if (cmd === 'restore')
    await pool.query("update catalog_item set status = 'ACTIVE' where id = $1", [CARD]);
  else throw new Error('unknown hook ' + cmd);
  await pool.end();
  console.log('ok', cmd);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
