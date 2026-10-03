import { describe, expect, it } from 'vitest';
import { validateConfiguration, priceAffectingOptionIds } from '@/domain/configuration';
import { validateItemOption, isSpecValidForKind } from '@/domain/options';
import { indexSnapshot } from '@/domain/snapshot';
import { itemId, optionDefId, req, sliceSnapshot } from '../fixtures/slice';

const ix = () => indexSnapshot(sliceSnapshot());
const codes = (r: ReturnType<typeof validateConfiguration>) =>
  r.ok ? [] : r.errors.map((e) => e.code);

describe('options', () => {
  it('accepts valid selections and rejects unknown values / options', () => {
    const i = ix();
    expect(
      codes(
        validateConfiguration(
          req('tarjeta_premium', {
            market: 'USA',
            quantity: 100,
            selections: [{ optionKey: 'caras', valueCodes: ['2'] }],
          }),
          i,
        ),
      ),
    ).toEqual([]);
    expect(
      codes(
        validateConfiguration(
          req('tarjeta_premium', {
            market: 'USA',
            quantity: 100,
            selections: [{ optionKey: 'caras', valueCodes: ['3'] }],
          }),
          i,
        ),
      ),
    ).toEqual(['INVALID_VALUE']);
    expect(
      codes(
        validateConfiguration(
          req('tarjeta_premium', {
            market: 'USA',
            quantity: 100,
            selections: [{ optionKey: 'caras', valueCodes: ['1', '2'] }],
          }),
          i,
        ),
      ),
    ).toEqual(['TOO_MANY_VALUES']);
    expect(
      codes(validateConfiguration(req('tarjeta_premium', { market: 'USA', quantity: 100 }), i)),
    ).toEqual(['MISSING_OPTION']);
    expect(
      codes(
        validateConfiguration(
          req('tarjeta_premium', {
            market: 'USA',
            quantity: 100,
            selections: [
              { optionKey: 'caras', valueCodes: ['1'] },
              { optionKey: 'talla', valueCodes: ['L'] },
            ],
          }),
          i,
        ),
      ),
    ).toEqual(['OPTION_NOT_ALLOWED']);
  });

  it('values are controlled per item: a global value not enabled for the item is invalid', () => {
    const s = sliceSnapshot();
    s.itemOptionValues = s.itemOptionValues.filter(
      (v) =>
        !(
          v.itemId === itemId('camiseta_dry_fit') &&
          v.optionValueId.length > 0 &&
          s.optionValues.find((o) => o.id === v.optionValueId)?.code === 'S'
        ),
    );
    const r = validateConfiguration(
      req('camiseta_dry_fit', {
        market: 'USA',
        quantity: 1,
        selections: [{ optionKey: 'talla', valueCodes: ['S'] }],
      }),
      indexSnapshot(s),
    );
    expect(codes(r)).toEqual(['INVALID_VALUE']);
  });

  it('TEXT options need text; enum-only rules do not apply to them', () => {
    const i = ix();
    const ok = validateConfiguration(
      req('camiseta_algodon', {
        market: 'USA',
        quantity: 1,
        selections: [
          { optionKey: 'talla', valueCodes: ['M'] },
          { optionKey: 'color', text: 'Negro' },
        ],
      }),
      i,
    );
    expect(ok.ok).toBe(true);
    const bad = validateConfiguration(
      req('camiseta_algodon', {
        market: 'USA',
        quantity: 1,
        selections: [{ optionKey: 'talla', valueCodes: ['M'] }, { optionKey: 'color' }],
      }),
      i,
    );
    expect(codes(bad)).toEqual(['INVALID_VALUE']);
  });

  it('only distributable options may vary across distribution rows', () => {
    const r = validateConfiguration(
      req('camiseta_algodon', {
        market: 'USA',
        quantity: 2,
        distribution: [
          {
            selections: [
              { optionKey: 'talla', valueCodes: ['M'] },
              { optionKey: 'color', text: 'Rojo' },
            ],
            quantity: 2,
          },
        ],
      }),
      ix(),
    );
    expect(codes(r)).toEqual(['OPTION_NOT_DISTRIBUTABLE']);
  });

  it('distributable must be a SINGLE enum; value specs are typed by kind', () => {
    const def = sliceSnapshot().optionDefinitions.find((d) => d.key === 'color')!;
    expect(
      validateItemOption(
        {
          itemId: 'x',
          optionDefinitionId: def.id,
          isRequired: false,
          selectionMode: 'SINGLE',
          isDistributable: true,
          sort: 1,
          defaultValueId: null,
        },
        def,
      ),
    ).toEqual(['DISTRIBUTABLE_REQUIRES_SINGLE_ENUM']);
    expect(isSpecValidForKind('DIMENSIONS', { w: 24, h: 63 })).toBe(true);
    expect(isSpecValidForKind('DIMENSIONS', null)).toBe(false);
    expect(isSpecValidForKind('ENUM', null)).toBe(true);
  });

  it('price-affecting options are derived, not stored', () => {
    const i = ix();
    expect(priceAffectingOptionIds(itemId('camiseta_algodon'), i)).toEqual(
      new Set([optionDefId('talla')]),
    );
    expect(priceAffectingOptionIds(itemId('gorra'), i).size).toBe(0);
    expect(priceAffectingOptionIds(itemId('flyers'), i).size).toBe(3);
  });
});

describe('decoration capability', () => {
  it('blank = no decoration selections; compatible methods only', () => {
    const i = ix();
    const base = {
      market: 'USA' as const,
      quantity: 1,
      selections: [{ optionKey: 'talla', valueCodes: ['M'] }],
    };
    expect(validateConfiguration(req('camiseta_algodon', base), i).ok).toBe(true);
    expect(
      validateConfiguration(
        req('camiseta_algodon', { ...base, decorations: [{ methodKey: 'EMBROIDERY' }] }),
        i,
      ).ok,
    ).toBe(true);
    expect(
      codes(
        validateConfiguration(
          req('camiseta_algodon', { ...base, decorations: [{ methodKey: 'BLANK' }] }),
          i,
        ),
      ),
    ).toEqual(['UNKNOWN_METHOD']);
    expect(
      codes(
        validateConfiguration(
          req('tarjeta_premium', {
            market: 'USA',
            quantity: 100,
            selections: [{ optionKey: 'caras', valueCodes: ['1'] }],
            decorations: [{ methodKey: 'DTF' }],
          }),
          i,
        ),
      ),
    ).toEqual(['DECORATION_NOT_ALLOWED']);
  });

  it('DTF the method is not the DTF Transfer product', () => {
    const s = sliceSnapshot();
    expect(s.decorationMethods.map((m) => m.key)).toContain('DTF');
    const transfer = s.items.find((i) => i.id === itemId('dtf_transfer'))!;
    expect(transfer.kind).toBe('PRODUCT');
    expect(s.decorationMethods.some((m) => m.id === transfer.id)).toBe(false);
  });
});
