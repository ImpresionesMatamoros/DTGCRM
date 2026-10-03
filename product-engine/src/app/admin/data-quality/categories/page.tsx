import { connection } from 'next/server';
import { categoryOptions, mappingHistory, sourceCategories } from '@/db/admin/category-mapping';
import { adminPool } from '../../_server/db';
import { getActor } from '../../_server/actor';
import { fmtDate } from '../../_components/ui';
import { QualityTabs } from '../nav';
import { CategoryMapper } from './category-mapper';

export default async function CategoriesPage() {
  await connection();
  const db = adminPool();
  const [rows, options, history, actor] = await Promise.all([
    sourceCategories(db),
    categoryOptions(db),
    mappingHistory(db, 20),
    getActor(),
  ]);
  return (
    <>
      <h1 className="adm-h1">Mapeo de categorías</h1>
      <p className="adm-sub">
        Categoría de origen (Excel) → categoría del Product Engine. Mínimo y explícito: ningún mapeo
        se deduce por el nombre y no se rediseña la taxonomía. Cada mapeo tiene vista previa de
        impacto y queda auditado.
      </p>
      <QualityTabs />
      <CategoryMapper rows={rows} options={options} hasActor={!!actor} />
      <div className="panel">
        <h2 className="adm-h2">Mapeos registrados</h2>
        <table className="t" data-testid="mapping-history">
          <tbody>
            {history.map((h) => (
              <tr key={h.id}>
                <td className="nowrap small">{fmtDate(h.decidedAt)}</td>
                <td className="mono small">{h.sourceCategory}</td>
                <td className="mono small">→ {h.categoryKey}</td>
                <td className="small">{h.actor}</td>
                <td className="small">{h.candidates} candidatos</td>
              </tr>
            ))}
            {history.length === 0 && (
              <tr>
                <td className="muted small">Todavía no hay mapeos registrados.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
