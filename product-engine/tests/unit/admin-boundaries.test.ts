import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseCatalogFilters, parsePage, parseReviewFilters } from '@/admin/filters';

/** STEP 06 auto-audit gates (§34, §45): the UI shows and sends; the server decides. */

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = path.join(dir, f);
    return statSync(p).isDirectory() ? files(p) : /\.(ts|tsx)$/.test(p) ? [p] : [];
  });
}

const ui = files('src/app/admin').map((f) => ({ f, src: readFileSync(f, 'utf8') }));
const client = ui.filter(({ src }) => src.startsWith("'use client'"));

describe('admin UI boundaries', () => {
  it('has pages and client components', () => {
    expect(ui.length).toBeGreaterThan(15);
    expect(client.length).toBeGreaterThan(5);
  });

  it.each([
    ['pricing engine', /from ['"]@\/pricing/],
    ['domain adapter', /from ['"]@\/import\/adapter/],
    ['requirement rules', /from ['"]@\/import\/requirements/],
    ['domain rules', /import \{[^}]*\} from ['"]@\/domain/],
    ['raw SQL', /\.query\(/],
  ])('never uses the %s directly', (_label, pattern) => {
    expect(ui.filter(({ src }) => pattern.test(src)).map(({ f }) => f)).toEqual([]);
  });

  it('client components never import persistence or server-only modules', () => {
    const offenders = client.filter(({ src }) =>
      /^import (?!type )[^;]*from ['"](@\/db|pg|@\/admin\/handlers|.*_server)/m.test(src),
    );
    expect(offenders.map(({ f }) => f)).toEqual([]);
  });

  it('exposes no Server Action to publish REAL data; price authorization only through the capability-gated handler', () => {
    const actions = readFileSync('src/app/admin/actions.ts', 'utf8');
    const exported = [...actions.matchAll(/export async function (\w+)/g)].map((m) => m[1]);
    // STEP 07: authorizing a price revision exists, but never REAL publication.
    expect(exported.filter((n) => /real/i.test(n!))).toEqual([]);
    expect(actions).not.toMatch(/publishCandidate/);
    expect(exported.filter((n) => /authoriz/i.test(n!))).toEqual(['authorizePriceRevisionAction']);
    // the action is a thin wrapper over a handler that demands the price.authorize capability
    expect(actions).toMatch(/authorizePriceHandler\(adminTx\(\), await getActor\(\)/);
    const handlers = readFileSync('src/admin/handlers.ts', 'utf8');
    expect(handlers).toMatch(/authorizePriceHandler[\s\S]{0,200}'price\.authorize'/);
  });

  it('STEP 09: the only REAL publication path is the permit-bound migration, gated by capability', () => {
    const actions = readFileSync('src/app/admin/actions.ts', 'utf8');
    const handlers = readFileSync('src/admin/handlers.ts', 'utf8');
    const exported = [...actions.matchAll(/export async function (\w+)/g)].map((m) => m[1]);
    expect(exported.filter((n) => /migration/i.test(n!)).sort()).toEqual([
      'approveMigrationPermitAction',
      'runMigrationPublicationAction',
      'simulateMigrationAction',
    ]);
    expect(handlers).toMatch(/migrationPermitHandler[\s\S]{0,120}'migration\.approve'/);
    expect(handlers).toMatch(/migrationPublishHandler[\s\S]{0,120}'migration\.publish'/);
    // no page or component publishes by itself: only the explicit action calls the handler
    const callers = ui
      .filter(
        ({ f, src }) =>
          f !== 'src/app/admin/actions.ts' && /runMigrationPublicationAction/.test(src),
      )
      .map(({ f }) => f);
    expect(callers).toEqual(['src/app/admin/migration/controls.tsx']);
    // the global barrier is never reassigned: a permit opens it per candidate inside publishCandidate
    const permit = readFileSync('src/db/migration/permit.ts', 'utf8');
    expect(permit).not.toMatch(/PUBLICATION_ENABLED_FOR\s*=/);
    const publish = readFileSync('src/db/import/publish.ts', 'utf8');
    expect(publish.match(/PUBLICATION_ENABLED_FOR[^=;]*=/g)).toHaveLength(1);
    expect(publish).toMatch(/permitCoversCandidate\(db, input\.permitId, c\.id\)/);
  });

  it('keeps publication restricted to FIXTURE', () => {
    const publish = readFileSync('src/db/import/publish.ts', 'utf8');
    expect(publish).toMatch(
      /PUBLICATION_ENABLED_FOR: readonly \('REAL' \| 'FIXTURE'\)\[\] = \['FIXTURE'\];/,
    );
  });
});

describe('server-side filter parsing', () => {
  it('keeps valid filters and drops anything invalid before SQL', () => {
    const f = parseReviewFilters({
      kind: 'OPTION',
      status: 'TO_REVIEW',
      catalogStatus: 'unresolved',
      hasPrice: 'yes',
      hasDuplicate: 'no',
      openField: 'isRequired',
      sort: 'open',
      q: '  lona ',
      ids: '6b3d1c4e-1a2b-4c3d-8e9f-0a1b2c3d4e5f, not-an-id',
    });
    expect(f).toMatchObject({
      kind: 'OPTION',
      status: 'TO_REVIEW',
      catalogStatus: 'unresolved',
      hasPrice: true,
      hasDuplicate: false,
      openField: 'isRequired',
      sort: 'open',
      q: 'lona',
      ids: ['6b3d1c4e-1a2b-4c3d-8e9f-0a1b2c3d4e5f'],
    });
    const bad = parseReviewFilters({
      kind: 'VARIANT',
      status: 'DONE',
      batchId: "x'; drop table import_candidate; --",
      openField: 'status = any',
      sort: 'id; drop',
    });
    expect(Object.values(bad).filter((v) => v !== undefined)).toEqual([]);
    expect(parsePage({ page: '3' })).toBe(3);
    expect(parsePage({ page: '-1' })).toBe(1);
    expect(
      parseCatalogFilters({ status: 'UNSET', category: 'NONE', kind: 'BUNDLE' }),
    ).toMatchObject({
      status: 'UNSET',
      categoryKey: 'NONE',
      kind: undefined,
    });
  });
});
