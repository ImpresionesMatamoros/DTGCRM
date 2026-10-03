import { seedId } from './ids';
import { emptyDataset, type SeedDataset } from './types';

/**
 * REFERENCE DATA (ADR-0013): structural data that is true for the business today.
 * Values marked provisional come from owner decisions after the STEP 01 audit
 * (OWNER_DECISIONS_POST_AUDIT) and are editable.
 */
export const REF = {
  marketUSA: seedId('market:USA'),
  marketMX: seedId('market:MX'),
  bookUSA: seedId('price_book:USA_MASTER'),
  bookMX: seedId('price_book:MX_DERIVED'),
  fxUsdMxn: seedId('pricing_parameter:usd_mxn_fx:2026-09-29'),
  method: {
    DTF: seedId('decoration_method:DTF'),
    EMBROIDERY: seedId('decoration_method:EMBROIDERY'),
    SCREEN_PRINTING: seedId('decoration_method:SCREEN_PRINTING'),
    HTV: seedId('decoration_method:HTV'),
  },
  profile: {
    crm: seedId('publication_profile:crm_internal'),
    catalog: seedId('publication_profile:catalog_general'),
    usa: seedId('publication_profile:price_list_usa'),
    mx: seedId('publication_profile:price_list_mx'),
  },
} as const;

const OWNER_DECISIONS_DATE = '2026-09-29T00:00:00Z';

export function referenceDataset(): SeedDataset {
  const d = emptyDataset();
  d.markets.push(
    { id: REF.marketUSA, code: 'USA', name: 'Estados Unidos', defaultCurrency: 'USD' },
    { id: REF.marketMX, code: 'MX', name: 'México', defaultCurrency: 'MXN' },
  );
  d.priceBooks.push(
    {
      id: REF.bookUSA,
      code: 'USA_MASTER',
      marketId: REF.marketUSA,
      currency: 'USD',
      mode: 'MASTER',
      sourcePriceBookId: null,
      defaultFactor: null,
    },
    {
      id: REF.bookMX,
      code: 'MX_DERIVED',
      marketId: REF.marketMX,
      currency: 'MXN',
      mode: 'DERIVED',
      sourcePriceBookId: REF.bookUSA,
      defaultFactor: '0.70', // BR-029 — provisional, editable
    },
  );
  d.pricingParameters.push({
    id: REF.fxUsdMxn,
    key: 'usd_mxn_fx',
    value: '16.50', // BR-030 (16.5) — provisional, editable
    validFrom: OWNER_DECISIONS_DATE,
    validTo: null,
  });
  d.decorationMethods.push(
    { id: REF.method.DTF, key: 'DTF', name: 'DTF textil', isActive: true },
    { id: REF.method.EMBROIDERY, key: 'EMBROIDERY', name: 'Bordado', isActive: true },
    { id: REF.method.SCREEN_PRINTING, key: 'SCREEN_PRINTING', name: 'Serigrafía', isActive: true },
    { id: REF.method.HTV, key: 'HTV', name: 'HTV / vinil textil', isActive: true },
  );
  d.publicationProfiles.push(
    {
      id: REF.profile.crm,
      key: 'crm_internal',
      name: 'CRM interno',
      inclusionMode: 'ALL_MATCHING',
      allowedStatuses: ['ACTIVE'],
      showsPrices: true,
      priceBookId: null,
      locale: 'es',
    },
    {
      id: REF.profile.catalog,
      key: 'catalog_general',
      name: 'Catálogo general (sin precios)',
      inclusionMode: 'EXPLICIT',
      allowedStatuses: ['ACTIVE'],
      showsPrices: false,
      priceBookId: null,
      locale: 'es',
    },
    {
      id: REF.profile.usa,
      key: 'price_list_usa',
      name: 'Lista de precios USA',
      inclusionMode: 'EXPLICIT',
      allowedStatuses: ['ACTIVE'],
      showsPrices: true,
      priceBookId: REF.bookUSA,
      locale: 'es',
    },
    {
      id: REF.profile.mx,
      key: 'price_list_mx',
      name: 'Lista de precios México',
      inclusionMode: 'EXPLICIT',
      allowedStatuses: ['ACTIVE'],
      showsPrices: true,
      priceBookId: REF.bookMX,
      locale: 'es',
    },
  );
  d.decisionRecords.push({
    id: seedId('decision:OD-MX-PRICING'),
    code: 'OD-MX-PRICING',
    title: 'Precio México derivado de USA',
    status: 'DECIDED',
    statement:
      'MXN = USD × factor México × tipo de cambio maestro. Factor default 0.70 sobrescribible por producto; ' +
      'tipo de cambio provisional 16.5 editable; precio manual MX prevalece. Redondeo e IVA pendientes (P1-02).',
    decidedBy: 'owner',
    decidedAt: OWNER_DECISIONS_DATE,
    source: 'OWNER_DECISIONS_POST_AUDIT.md',
    subjects: [],
  });
  return d;
}
