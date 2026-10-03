import Link from 'next/link';
import { connection } from 'next/server';
import { listCategories } from '@/db/admin/catalog';
import { adminPool } from '../../_server/db';
import { getActor } from '../../_server/actor';
import { CreateItemForm } from './create-form';

export default async function NewItemPage() {
  await connection();
  const [categories, actor] = await Promise.all([listCategories(adminPool()), getActor()]);
  return (
    <>
      <div className="crumbs">
        <Link href="/admin/catalog">Catálogo</Link> /
      </div>
      <h1 className="adm-h1">Nuevo CatalogItem</h1>
      <p className="adm-sub">
        Mínimo. Opciones, decoración, composición y precios se asocian después. El código DTG lo
        asigna la base al guardar.
      </p>
      <CreateItemForm categories={categories.filter((c) => c.isActive)} hasActor={actor !== null} />
    </>
  );
}
