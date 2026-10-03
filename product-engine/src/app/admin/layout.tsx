import Link from 'next/link';
import type { ReactNode } from 'react';
import './admin.css';
import { setActorAction } from './actions';
import { getActor } from './_server/actor';

export const metadata = { title: 'Admin · DTG Product Engine' };

export default async function AdminLayout({ children }: { children: ReactNode }) {
  const actor = await getActor();
  return (
    <div className="adm">
      <header className="adm-top">
        <Link href="/admin" className="adm-brand">
          DTG Product Engine · Admin
        </Link>
        <nav className="adm-nav">
          <Link href="/admin/imports">Importaciones</Link>
          <Link href="/admin/review">Revisión</Link>
          <Link href="/admin/catalog">Catálogo</Link>
          <Link href="/admin/pricing">Precios</Link>
          <Link href="/admin/data-quality">Calidad</Link>
          <Link href="/admin/decisions">Decisiones</Link>
          <Link href="/admin/migration">Migración</Link>
        </nav>
        <div className="adm-actor">
          {actor?.source === 'env' ? (
            <span title="DTG_ADMIN_ACTOR">
              Actor: <strong>{actor.name}</strong> (entorno)
            </span>
          ) : (
            <form action={setActorAction} className="row">
              <label htmlFor="actor">Actor:</label>
              <input
                id="actor"
                name="actor"
                type="text"
                defaultValue={actor?.name ?? ''}
                placeholder="¿quién eres?"
                maxLength={60}
              />
              <button className="btn" type="submit">
                {actor ? 'Cambiar' : 'Usar'}
              </button>
            </form>
          )}
        </div>
      </header>
      {!actor && (
        <div className="adm-main" style={{ paddingBottom: 0 }}>
          <div className="notice warn">
            Sin actor local no se puede cambiar nada: escribe tu nombre arriba (queda registrado en
            cada cambio y en la auditoría). No existe un actor por defecto.
          </div>
        </div>
      )}
      <main className="adm-main">{children}</main>
    </div>
  );
}
