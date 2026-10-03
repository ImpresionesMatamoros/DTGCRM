import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/** Gate M1: pure layers do not depend on the database, the framework or the clock. */
const PURE = ['src/domain', 'src/pricing', 'src/api', 'src/shared', 'src/review'];

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = path.join(dir, f);
    return statSync(p).isDirectory() ? files(p) : p.endsWith('.ts') ? [p] : [];
  });
}

const sources = PURE.flatMap(files).map((f) => ({ f, src: readFileSync(f, 'utf8') }));

describe('pure layers', () => {
  it('exist', () => expect(sources.length).toBeGreaterThan(8));

  it.each([
    ['database driver', /from ['"]pg['"]/],
    ['persistence layer', /from ['"](@\/db|\.\.\/db)/],
    ['framework', /from ['"](next|next\/.*|react|react-dom)['"]/],
    ['clock: Date.now()', /Date\.now\(/],
    ['clock: new Date()', /new Date\(\s*\)/],
    ['randomness', /Math\.random\(/],
  ])('do not use the %s', (_label, pattern) => {
    const offenders = sources.filter(({ src }) => pattern.test(src)).map(({ f }) => f);
    expect(offenders).toEqual([]);
  });
});
