import type { CatalogItem, Uuid } from '../domain/catalog';
import {
  validateConfiguration,
  type PriceRequest,
  type ValidConfiguration,
} from '../domain/configuration';
import { includedChildrenOf } from '../domain/composition';
import {
  effectiveMarketMode,
  fxParameterKey,
  isEffective,
  type PriceBook,
  type PricingParameter,
} from '../domain/market';
import type { PriceCondition, PriceDefinition, PriceRule } from '../domain/pricing-model';
import { indexSnapshot, type CatalogSnapshot, type SnapshotIndex } from '../domain/snapshot';
import {
  addMoney,
  convertMoney,
  money,
  multiplyMoney,
  roundMoney,
  sumMoney,
  toDecimal,
  type CurrencyCode,
  type Money,
} from '../shared/money';
import type {
  AmbiguousReason,
  AppliedRule,
  BreakdownLine,
  Derivation,
  PolicyApplied,
  PriceResult,
  PricingBasis,
  QuoteOnlyReason,
  ResolvedComponent,
} from './result';

/**
 * Pure, deterministic price resolution (PRICING-ENGINE-CONTRACT; ADR-0001…0010).
 * `asOf` is mandatory: this module never reads the clock (ADR-0009).
 */
export function resolvePrice(
  request: PriceRequest,
  snapshot: CatalogSnapshot,
  asOf: Date,
): PriceResult {
  if (!(asOf instanceof Date) || Number.isNaN(asOf.getTime())) {
    throw new TypeError('resolvePrice requires an explicit, valid `asOf` instant');
  }
  return resolveWithIndex(request, indexSnapshot(snapshot), asOf, 0);
}

const MAX_COMPONENT_DEPTH = 1;

type Selected = Map<Uuid, Set<Uuid>>;

type ItemOutcome =
  | { kind: 'ok'; total: Money; lines: BreakdownLine[]; rules: AppliedRule[] }
  | {
      kind: 'quote';
      reason: QuoteOnlyReason;
      detail: string | null;
      knownLines: BreakdownLine[];
      knownAdjustments: BreakdownLine[];
    }
  | { kind: 'ambiguous'; reason: AmbiguousReason; ids: Uuid[]; detail: string | null };

function resolveWithIndex(
  req: PriceRequest,
  ix: SnapshotIndex,
  asOf: Date,
  depth: number,
): PriceResult {
  const market = ix.marketByCode.get(req.market);
  const book = market ? ix.bookByMarketId.get(market.id) : undefined;
  const common = {
    catalogItemId: req.catalogItemId,
    market: req.market,
    quantity: req.quantity,
    currency: book?.currency ?? null,
    policy: null as PolicyApplied | null,
    effectiveAt: asOf.toISOString(),
    revisions: ix.snapshot.revisions,
    explanation: [] as string[],
  };

  const validation = validateConfiguration(req, ix);
  if (!validation.ok) {
    return {
      ...common,
      status: 'INVALID',
      errors: validation.errors,
      explanation: validation.errors.map((e) => `Configuración inválida: ${e.code} en ${e.path}`),
    };
  }
  const cfg = validation.config;
  if (!book) {
    return ambiguous(common, 'POLICY_MISCONFIGURED', [], `Sin price book para ${req.market}`);
  }

  const policy = ix.policyByItemMarket.get(`${cfg.item.id}:${cfg.marketId}`);
  const eff = effectiveMarketMode(book, policy);
  const basis: PricingBasis =
    eff.mode === 'QUOTE_ONLY'
      ? 'POLICY_QUOTE_ONLY'
      : eff.mode === 'MISCONFIGURED'
        ? 'MASTER'
        : eff.mode;
  common.policy = {
    market: req.market,
    priceBookCode: book.code,
    basis,
    ...(eff.mode === 'DERIVED' ? { factor: eff.factor, factorSource: eff.factorSource } : {}),
  };

  if (eff.mode === 'MISCONFIGURED') {
    return ambiguous(common, 'POLICY_MISCONFIGURED', [cfg.item.id], eff.detail);
  }
  if (eff.mode === 'QUOTE_ONLY') {
    return quote(
      common,
      'MARKET_POLICY_QUOTE_ONLY',
      null,
      [],
      [],
      [`${cfg.item.canonicalName}: política de mercado ${req.market} = sólo cotización.`],
    );
  }

  let outcome: ItemOutcome;
  let derivation: Derivation | null = null;
  const explanation: string[] = [];

  if (eff.mode === 'MASTER' || eff.mode === 'MANUAL') {
    outcome = priceInBook(cfg, book, ix, asOf);
    if (eff.mode === 'MANUAL' && outcome.kind === 'quote' && isMissingPrice(outcome.reason)) {
      outcome = {
        ...outcome,
        reason: 'MANUAL_MX_PRICE_MISSING',
        detail: `${outcome.reason}: política MANUAL sin precio manual para esta configuración; no se deriva`,
      };
    }
    if (eff.mode === 'MANUAL' && outcome.kind === 'ok') {
      const missing = rulesMissingInBook(cfg, book, ix, asOf);
      if (missing.length > 0) {
        outcome = {
          kind: 'quote',
          reason: 'RULE_NOT_DEFINED_FOR_MARKET',
          detail: missing.join(', '),
          knownLines: outcome.lines,
          knownAdjustments: [],
        };
      }
    }
  } else {
    const source = ix.bookById.get(eff.priceBook.sourcePriceBookId);
    if (!source) {
      return ambiguous(common, 'POLICY_MISCONFIGURED', [book.id], 'Price book fuente inexistente');
    }
    const src = priceInBook(cfg, source, ix, asOf);
    if (src.kind !== 'ok') {
      outcome = src;
    } else {
      const fx = pickParameter(
        ix.snapshot.pricingParameters,
        fxParameterKey(source.currency, book.currency),
        asOf,
      );
      if (fx.kind === 'missing') {
        outcome = {
          kind: 'quote',
          reason: 'FX_PARAMETER_MISSING',
          detail: fx.key,
          knownLines: src.lines,
          knownAdjustments: [],
        };
      } else if (fx.kind === 'overlap') {
        outcome = {
          kind: 'ambiguous',
          reason: 'FX_PARAMETER_OVERLAP',
          ids: fx.ids,
          detail: fx.key,
        };
      } else {
        const sourceTotal = roundMoney(src.total);
        const derivedTotal = roundMoney(
          convertMoney(sourceTotal, book.currency, [eff.factor, fx.parameter.value]),
        );
        derivation = {
          sourcePriceBookCode: source.code,
          sourceTotal,
          factor: eff.factor,
          factorSource: eff.factorSource,
          fx: fx.parameter.value,
          fxParameterId: fx.parameter.id,
          rounding: 'HALF_UP_2',
          derivedTotal,
        };
        outcome = {
          kind: 'ok',
          total: derivedTotal,
          rules: src.rules,
          lines: [
            ...src.lines,
            {
              kind: 'MARKET_DERIVATION',
              label: `${source.currency} ${sourceTotal.amount.toFixed(2)} × factor ${eff.factor} × FX ${fx.parameter.value}`,
              quantity: cfg.quantity,
              amount: derivedTotal,
              source: { catalogItemId: cfg.item.id, basis: 'DERIVED' },
            },
          ],
        };
        explanation.push(
          `Precio ${req.market} derivado: ${sourceTotal.amount.toFixed(2)} ${source.currency} × ${eff.factor} (${eff.factorSource === 'ITEM' ? 'factor del producto' : 'factor default'}) × ${fx.parameter.value} = ${derivedTotal.amount.toFixed(2)} ${book.currency}.`,
        );
      }
    }
  }

  if (outcome.kind === 'ambiguous') {
    return ambiguous(common, outcome.reason, outcome.ids, outcome.detail);
  }
  if (outcome.kind === 'quote') {
    return quote(
      common,
      outcome.reason,
      outcome.detail,
      outcome.knownLines,
      outcome.knownAdjustments,
      [
        ...explainQuote(cfg.item, outcome.reason, outcome.detail),
        ...outcome.knownAdjustments.map(
          (a) =>
            `Aplicaría ${a.label}: ${a.quantity} unidad(es) = +${a.amount?.amount.toFixed(2)} ${a.amount?.currency} (informativo, no se suma).`,
        ),
      ],
    );
  }

  // ---- optional components: each item resolves its own market policy (ADR-0010)
  const components: ResolvedComponent[] = [];
  const lines = [...outcome.lines];
  let total = outcome.total;
  for (const oc of cfg.optionalComponents) {
    if (depth >= MAX_COMPONENT_DEPTH) break;
    const child = resolveWithIndex(
      { catalogItemId: oc.item.id, market: req.market, quantity: oc.quantity },
      ix,
      asOf,
      depth + 1,
    );
    if (child.status === 'INVALID') {
      return {
        ...common,
        status: 'INVALID',
        errors: child.errors.map((e) => ({
          ...e,
          path: `optionalComponents(${oc.item.publicCode}).${e.path}`,
        })),
        explanation: child.explanation,
      };
    }
    if (child.status === 'AMBIGUOUS') {
      return ambiguous(
        common,
        child.reasonCode,
        child.conflictingIds,
        `componente ${oc.item.publicCode}: ${child.detail ?? ''}`,
      );
    }
    if (child.status === 'QUOTE_ONLY') {
      return quote(
        common,
        'COMPONENT_NOT_PRICED',
        `${oc.item.publicCode}: ${child.reasonCode}`,
        lines,
        [],
        [
          `El componente opcional ${oc.item.canonicalName} no tiene precio resoluble (${child.reasonCode}); no se inventa el total.`,
        ],
      );
    }
    components.push({ catalogItemId: oc.item.id, quantity: oc.quantity, result: child });
    lines.push({
      kind: 'COMPONENT_OPTIONAL',
      label: oc.item.canonicalName,
      quantity: oc.quantity,
      amount: child.total,
      source: { catalogItemId: oc.item.id, basis: child.policy?.basis ?? 'MASTER' },
    });
    total = addMoney(total, child.total); // throws on currency mismatch: never silently mixed
  }

  const currency = book.currency;
  return {
    ...common,
    status: 'RESOLVED',
    currency,
    total: roundMoney(total),
    breakdown: lines,
    rulesApplied: outcome.rules,
    derivation,
    components,
    explanation: [
      `${cfg.item.canonicalName} × ${cfg.quantity}: total ${roundMoney(total).amount.toFixed(2)} ${currency}.`,
      ...explanation,
    ],
  };
}

// ------------------------------------------------------------------ in one price book

function priceInBook(
  cfg: ValidConfiguration,
  book: PriceBook,
  ix: SnapshotIndex,
  asOf: Date,
): ItemOutcome {
  const currency = book.currency;
  const methods = new Set(cfg.decorationMethodIds);

  // 1. Rules first: conflicts are catalog defects and must surface even without a base price.
  const ruleEval = evaluateRules(cfg, book, ix, asOf, methods);
  if (ruleEval.kind === 'ambiguous') return ruleEval;
  const { adjustments, applied, requireQuote } = ruleEval;
  if (requireQuote) {
    return {
      kind: 'quote',
      reason: 'RULE_REQUIRES_QUOTE',
      detail: requireQuote,
      knownLines: [],
      knownAdjustments: adjustments,
    };
  }

  if (cfg.item.saleUnit === null) {
    return {
      kind: 'quote',
      reason: 'NO_SALE_UNIT',
      detail: null,
      knownLines: [],
      knownAdjustments: adjustments,
    };
  }

  // 2. Base (ITEM) definition: common selections + total quantity (ADR-0001).
  const baseDefs = candidateDefinitions(
    ix,
    cfg.item.id,
    book.id,
    'ITEM',
    asOf,
    cfg.common,
    new Set(),
  );
  const base = pickMostSpecific(baseDefs);
  if (base.kind === 'none') {
    return {
      kind: 'quote',
      reason: 'NO_AUTHORIZED_BASE_PRICE',
      detail: null,
      knownLines: [],
      knownAdjustments: adjustments,
    };
  }
  if (base.kind === 'tie') {
    return { kind: 'ambiguous', reason: 'BASE_DEFINITION_OVERLAP', ids: base.ids, detail: null };
  }
  const baseAmount = evaluateModel(base.def, cfg, currency);
  if (baseAmount.kind !== 'ok') {
    return baseAmount.kind === 'quote'
      ? {
          kind: 'quote',
          reason: baseAmount.reason,
          detail: baseAmount.detail,
          knownLines: [],
          knownAdjustments: adjustments,
        }
      : {
          kind: 'ambiguous',
          reason: 'DEFINITION_MISCONFIGURED',
          ids: [base.def.id],
          detail: baseAmount.detail,
        };
  }
  const lines: BreakdownLine[] = [
    {
      kind: 'BASE',
      label: cfg.item.canonicalName,
      quantity: cfg.quantity,
      amount: baseAmount.amount,
      source: {
        catalogItemId: cfg.item.id,
        priceDefinitionId: base.def.id,
        priceDefinitionVersion: base.def.version,
        ...(baseAmount.breakQuantity !== undefined
          ? { breakQuantity: baseAmount.breakQuantity }
          : {}),
      },
    },
  ];

  // 3. Decorations: one DECORATION definition per selection (ADR-0004).
  for (const methodId of cfg.decorationMethodIds) {
    const method = ix.methodById.get(methodId);
    const defs = candidateDefinitions(
      ix,
      cfg.item.id,
      book.id,
      'DECORATION',
      asOf,
      cfg.common,
      new Set([methodId]),
    ).filter((d) =>
      d.conditions.some((c) => c.kind === 'DECORATION_METHOD' && c.decorationMethodId === methodId),
    );
    const pick = pickMostSpecific(defs);
    if (pick.kind === 'none') {
      return {
        kind: 'quote',
        reason: 'NO_AUTHORIZED_DECORATION_PRICE',
        detail: method?.key ?? methodId,
        knownLines: lines,
        knownAdjustments: adjustments,
      };
    }
    if (pick.kind === 'tie') {
      return {
        kind: 'ambiguous',
        reason: 'DECORATION_DEFINITION_OVERLAP',
        ids: pick.ids,
        detail: method?.key ?? null,
      };
    }
    const amt = evaluateModel(pick.def, cfg, currency);
    if (amt.kind !== 'ok') {
      return amt.kind === 'quote'
        ? {
            kind: 'quote',
            reason: amt.reason,
            detail: `decoración ${method?.key}: ${amt.detail ?? ''}`,
            knownLines: lines,
            knownAdjustments: adjustments,
          }
        : {
            kind: 'ambiguous',
            reason: 'DEFINITION_MISCONFIGURED',
            ids: [pick.def.id],
            detail: amt.detail,
          };
    }
    lines.push({
      kind: 'DECORATION',
      label: `Decoración ${method?.name ?? methodId}`,
      quantity: cfg.quantity,
      amount: amt.amount,
      source: {
        priceDefinitionId: pick.def.id,
        priceDefinitionVersion: pick.def.version,
        ...(amt.breakQuantity !== undefined ? { breakQuantity: amt.breakQuantity } : {}),
      },
    });
  }

  // 4. Included components: listed as content, priced inside the parent.
  for (const l of includedChildrenOf(cfg.item.id, ix.snapshot.compositionLines)) {
    const child = ix.itemById.get(l.childItemId);
    lines.push({
      kind: 'COMPONENT_INCLUDED',
      label: child?.canonicalName ?? l.childItemId,
      quantity: l.quantity * cfg.quantity,
      amount: null,
      source: { catalogItemId: l.childItemId },
    });
  }

  lines.push(...adjustments);
  const priced = lines.filter((l) => l.amount !== null).map((l) => l.amount as Money);
  return { kind: 'ok', total: sumMoney(priced, currency), lines, rules: applied };
}

function isMissingPrice(reason: QuoteOnlyReason): boolean {
  return (
    reason === 'NO_AUTHORIZED_BASE_PRICE' ||
    reason === 'QUANTITY_NOT_IN_MATRIX' ||
    reason === 'NO_AUTHORIZED_DECORATION_PRICE' ||
    reason === 'FIXED_PRICE_QUANTITY_NOT_AUTHORIZED'
  );
}

// ------------------------------------------------------------------ definitions

/**
 * Authorized commercial revisions resolve inside their validity interval. A SUPERSEDED revision keeps
 * the (closed) interval it had, so replaying a past `asOf` reproduces the price valid back then
 * (ADR-0017); after supersession it can no longer match a current date because its `valid_to` is
 * the successor's `valid_from`. DRAFT never resolves here.
 */
function isLive(status: string, validFrom: string, validTo: string | null, asOf: Date): boolean {
  return (
    (status === 'AUTHORIZED' || status === 'SUPERSEDED') && isEffective(validFrom, validTo, asOf)
  );
}

/** AND across option definitions, IN within one option; decoration conditions match selected methods. */
export function conditionsMatch(
  conditions: readonly PriceCondition[],
  values: Selected,
  methods: ReadonlySet<Uuid>,
): boolean {
  const byOption = new Map<Uuid, Set<Uuid>>();
  const methodConds = new Set<Uuid>();
  for (const c of conditions) {
    if (c.kind === 'OPTION_VALUE') {
      byOption.set(
        c.optionDefinitionId,
        (byOption.get(c.optionDefinitionId) ?? new Set()).add(c.optionValueId),
      );
    } else methodConds.add(c.decorationMethodId);
  }
  for (const [defId, wanted] of byOption) {
    const selected = values.get(defId);
    if (!selected || ![...selected].some((v) => wanted.has(v))) return false;
  }
  for (const m of methodConds) if (!methods.has(m)) return false;
  return true;
}

function specificity(conditions: readonly PriceCondition[]): number {
  const keys = new Set(
    conditions.map((c) =>
      c.kind === 'OPTION_VALUE' ? `o:${c.optionDefinitionId}` : `m:${c.decorationMethodId}`,
    ),
  );
  return keys.size;
}

function candidateDefinitions(
  ix: SnapshotIndex,
  itemId: Uuid,
  bookId: Uuid,
  component: 'ITEM' | 'DECORATION',
  asOf: Date,
  values: Selected,
  methods: ReadonlySet<Uuid>,
): PriceDefinition[] {
  return ix.snapshot.priceDefinitions.filter(
    (d) =>
      d.itemId === itemId &&
      d.priceBookId === bookId &&
      d.component === component &&
      isLive(d.status, d.validFrom, d.validTo, asOf) &&
      conditionsMatch(d.conditions, values, methods),
  );
}

type Pick = { kind: 'none' } | { kind: 'one'; def: PriceDefinition } | { kind: 'tie'; ids: Uuid[] };

function pickMostSpecific(defs: PriceDefinition[]): Pick {
  if (defs.length === 0) return { kind: 'none' };
  const top = Math.max(...defs.map((d) => specificity(d.conditions)));
  const best = defs.filter((d) => specificity(d.conditions) === top);
  if (best.length > 1) return { kind: 'tie', ids: best.map((d) => d.id) };
  return { kind: 'one', def: best[0] as PriceDefinition };
}

type ModelOutcome =
  | { kind: 'ok'; amount: Money; breakQuantity?: number }
  | { kind: 'quote'; reason: QuoteOnlyReason; detail: string | null }
  | { kind: 'misconfigured'; detail: string };

function evaluateModel(
  def: PriceDefinition,
  cfg: ValidConfiguration,
  currency: CurrencyCode,
): ModelOutcome {
  const qty = cfg.quantity;
  switch (def.model) {
    case 'FIXED':
      if (qty > def.maxQuantity) {
        return {
          kind: 'quote',
          reason: 'FIXED_PRICE_QUANTITY_NOT_AUTHORIZED',
          detail: `máximo ${def.maxQuantity}`,
        };
      }
      return { kind: 'ok', amount: money(def.amount, currency) };
    case 'PER_UNIT':
      if (def.minQuantity !== null && qty < def.minQuantity) {
        return { kind: 'quote', reason: 'BELOW_MIN_QUANTITY', detail: `mínimo ${def.minQuantity}` };
      }
      if (def.maxQuantity !== null && qty > def.maxQuantity) {
        return { kind: 'quote', reason: 'ABOVE_MAX_QUANTITY', detail: `máximo ${def.maxQuantity}` };
      }
      return { kind: 'ok', amount: multiplyMoney(money(def.amount, currency), qty) };
    case 'EXACT_QUANTITY_MATRIX': {
      // Exact points only; never interpolate (BR-023).
      const hit = def.breaks.find((b) => b.quantity === qty);
      if (!hit) {
        const available = def.breaks
          .map((b) => b.quantity)
          .sort((a, b) => a - b)
          .join(', ');
        return {
          kind: 'quote',
          reason: 'QUANTITY_NOT_IN_MATRIX',
          detail: `cantidad ${qty}; disponibles: ${available}`,
        };
      }
      const unit = money(hit.amount, currency);
      return {
        kind: 'ok',
        amount: hit.amountBasis === 'TOTAL' ? unit : multiplyMoney(unit, qty),
        breakQuantity: hit.quantity,
      };
    }
    case 'TIERED': {
      const tier = [...def.breaks]
        .sort((a, b) => b.quantity - a.quantity)
        .find((b) => b.quantity <= qty);
      if (!tier) return { kind: 'quote', reason: 'BELOW_MIN_QUANTITY', detail: null };
      const unit = money(tier.amount, currency);
      return {
        kind: 'ok',
        amount: tier.amountBasis === 'TOTAL' ? unit : multiplyMoney(unit, qty),
        breakQuantity: tier.quantity,
      };
    }
    case 'MEASURED': {
      const spec = cfg.item.measurementSpec;
      const m = cfg.measurements;
      if (!spec || !m) return { kind: 'misconfigured', detail: 'MEASURED sin measurement_spec' };
      const toFt = (v: number) => (m.unit === 'in' ? toDecimal(v).dividedBy(12) : toDecimal(v));
      let measure;
      if (def.rateUnit === 'SQ_FT' && spec.kind === 'AREA') {
        measure = toFt(m.width ?? 0).times(toFt(m.height ?? 0));
      } else if (def.rateUnit === 'LINEAR_FT' && spec.kind === 'LENGTH') {
        measure = toFt(m.length ?? 0);
      } else {
        return {
          kind: 'misconfigured',
          detail: `rate_unit ${def.rateUnit} incompatible con ${spec.kind}`,
        };
      }
      let amount = money(toDecimal(def.rate).times(measure).times(qty), currency);
      if (def.minCharge !== null && amount.amount.lessThan(toDecimal(def.minCharge))) {
        amount = money(def.minCharge, currency);
      }
      return { kind: 'ok', amount };
    }
  }
}

// ------------------------------------------------------------------ rules

type RuleEval =
  | { kind: 'ambiguous'; reason: AmbiguousReason; ids: Uuid[]; detail: string | null }
  | {
      kind: 'ok';
      adjustments: BreakdownLine[];
      applied: AppliedRule[];
      requireQuote: string | null;
    };

function liveRulesFor(itemId: Uuid, bookId: Uuid, ix: SnapshotIndex, asOf: Date): PriceRule[] {
  return ix.snapshot.priceRules.filter(
    (r) =>
      r.priceBookId === bookId &&
      r.itemIds.includes(itemId) &&
      isLive(r.status, r.validFrom, r.validTo, asOf),
  );
}

/** Rules evaluate per distribution row: surcharges touch only the affected units (ADR-0001). */
function evaluateRules(
  cfg: ValidConfiguration,
  book: PriceBook,
  ix: SnapshotIndex,
  asOf: Date,
  methods: ReadonlySet<Uuid>,
): RuleEval {
  const rules = liveRulesFor(cfg.item.id, book.id, ix, asOf);
  const perRuleQty = new Map<Uuid, { rule: PriceRule; qty: number }>();
  let requireQuote: string | null = null;
  for (const row of cfg.rows) {
    const matched = rules.filter((r) => conditionsMatch(r.conditions, row.values, methods));
    const groups = new Map<string, PriceRule[]>();
    for (const r of matched) {
      const key = r.exclusivityKey ?? `rule:${r.id}`;
      groups.set(key, [...(groups.get(key) ?? []), r]);
    }
    for (const [key, group] of groups) {
      const distinct = new Set(group.map((r) => `${r.kind}:${r.amount ?? ''}`));
      if (distinct.size > 1) {
        return {
          kind: 'ambiguous',
          reason: 'RULE_CONFLICT',
          ids: group.map((r) => r.id),
          detail: key,
        };
      }
      const r = group[0] as PriceRule; // identical rules in one group count once
      if (r.kind === 'REQUIRE_QUOTE') requireQuote = r.code;
      const prev = perRuleQty.get(r.id);
      perRuleQty.set(r.id, { rule: r, qty: (prev?.qty ?? 0) + row.quantity });
    }
  }
  const adjustments: BreakdownLine[] = [];
  const applied: AppliedRule[] = [];
  for (const { rule, qty } of perRuleQty.values()) {
    applied.push({ ruleId: rule.id, code: rule.code, version: rule.version });
    if (rule.kind === 'REQUIRE_QUOTE' || rule.amount === null) continue;
    const unit = money(rule.amount, book.currency);
    adjustments.push({
      kind: 'RULE',
      label: rule.label,
      quantity: rule.kind === 'ADD_PER_UNIT' ? qty : 1,
      amount: rule.kind === 'ADD_PER_UNIT' ? multiplyMoney(unit, qty) : unit,
      source: { ruleId: rule.id, ruleCode: rule.code, ruleVersion: rule.version },
    });
  }
  return { kind: 'ok', adjustments, applied, requireQuote };
}

/** MANUAL market: a rule matching in the source book must exist (same code) in this book. */
function rulesMissingInBook(
  cfg: ValidConfiguration,
  book: PriceBook,
  ix: SnapshotIndex,
  asOf: Date,
): string[] {
  if (book.mode !== 'DERIVED') return [];
  const methods = new Set(cfg.decorationMethodIds);
  const matchedCodes = (bookId: Uuid) =>
    new Set(
      liveRulesFor(cfg.item.id, bookId, ix, asOf)
        .filter((r) => cfg.rows.some((row) => conditionsMatch(r.conditions, row.values, methods)))
        .map((r) => r.code),
    );
  const here = matchedCodes(book.id);
  return [...matchedCodes(book.sourcePriceBookId)].filter((c) => !here.has(c));
}

// ------------------------------------------------------------------ parameters & helpers

type ParamPick =
  | { kind: 'one'; parameter: PricingParameter }
  | { kind: 'missing'; key: string }
  | { kind: 'overlap'; key: string; ids: Uuid[] };

function pickParameter(params: readonly PricingParameter[], key: string, asOf: Date): ParamPick {
  const live = params.filter((p) => p.key === key && isEffective(p.validFrom, p.validTo, asOf));
  if (live.length === 0) return { kind: 'missing', key };
  if (live.length > 1) return { kind: 'overlap', key, ids: live.map((p) => p.id) };
  return { kind: 'one', parameter: live[0] as PricingParameter };
}

type Common = Omit<Extract<PriceResult, { status: 'INVALID' }>, 'status' | 'errors'>;

function quote(
  common: Common,
  reason: QuoteOnlyReason,
  detail: string | null,
  knownLines: BreakdownLine[],
  knownAdjustments: BreakdownLine[],
  explanation: string[],
): PriceResult {
  return {
    ...common,
    status: 'QUOTE_ONLY',
    reasonCode: reason,
    detail,
    knownLines,
    knownAdjustments,
    explanation,
  };
}

function ambiguous(
  common: Common,
  reason: AmbiguousReason,
  ids: Uuid[],
  detail: string | null,
): PriceResult {
  return {
    ...common,
    status: 'AMBIGUOUS',
    reasonCode: reason,
    conflictingIds: ids,
    detail,
    explanation: [`Defecto de datos del catálogo (${reason}); tratar como cotización manual.`],
  };
}

function explainQuote(item: CatalogItem, reason: QuoteOnlyReason, detail: string | null): string[] {
  const d = detail ? ` (${detail})` : '';
  switch (reason) {
    case 'NO_AUTHORIZED_BASE_PRICE':
      return [`No existe precio base autorizado para ${item.canonicalName}; requiere cotización.`];
    case 'QUANTITY_NOT_IN_MATRIX':
      return [`La cantidad no está en la matriz de cantidades exactas${d}; no se interpola.`];
    default:
      return [`${item.canonicalName}: requiere cotización — ${reason}${d}.`];
  }
}
