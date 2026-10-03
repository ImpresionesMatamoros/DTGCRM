// product-engine/src/api/crm-handlers.ts
import { ZodError } from "zod";

// product-engine/src/domain/composition.ts
function optionalChildrenOf(parentId, lines) {
  return lines.filter((l) => l.parentItemId === parentId && l.role === "OPTIONAL");
}
function includedChildrenOf(parentId, lines) {
  return lines.filter((l) => l.parentItemId === parentId && l.role === "INCLUDED").sort((a, b) => a.sort - b.sort);
}

// product-engine/src/domain/configuration.ts
var isPositiveInt = (n2) => Number.isInteger(n2) && n2 > 0;
function validateConfiguration(req, ix) {
  const errors = [];
  const err = (code, path, detail) => errors.push(detail === void 0 ? { code, path } : { code, path, detail });
  const item = ix.itemById.get(req.catalogItemId);
  if (!item) return { ok: false, errors: [{ code: "UNKNOWN_ITEM", path: "catalogItemId" }] };
  if (item.status !== "ACTIVE") {
    err("ITEM_NOT_ACTIVE", "catalogItemId", item.status ?? "UNSET");
  }
  const market = ix.marketByCode.get(req.market);
  if (!market) {
    err("UNKNOWN_MARKET", "market");
  } else {
    const policy = ix.policyByItemMarket.get(`${item.id}:${market.id}`);
    if (policy && !policy.isAvailable) err("ITEM_NOT_AVAILABLE_IN_MARKET", "market");
  }
  if (!isPositiveInt(req.quantity)) err("INVALID_QUANTITY", "quantity");
  const itemOptions = ix.itemOptionsByItem.get(item.id) ?? [];
  const optByDef = new Map(itemOptions.map((o) => [o.optionDefinitionId, o]));
  const resolveSelections = (sels, path, distributableOnly) => {
    const out = /* @__PURE__ */ new Map();
    sels.forEach((s2, i) => {
      const p = `${path}[${i}]`;
      const def = ix.optionDefByKey.get(s2.optionKey);
      const io = def ? optByDef.get(def.id) : void 0;
      if (!def || !io) return err("OPTION_NOT_ALLOWED", p, s2.optionKey);
      if (out.has(def.id)) return err("DUPLICATE_OPTION", p, s2.optionKey);
      if (distributableOnly && !io.isDistributable) {
        return err("OPTION_NOT_DISTRIBUTABLE", p, s2.optionKey);
      }
      out.set(def.id, /* @__PURE__ */ new Set());
      if (def.valueKind === "TEXT") {
        if (typeof s2.text !== "string" || s2.text.trim() === "")
          err("INVALID_VALUE", p, s2.optionKey);
        return;
      }
      if (def.valueKind === "BOOLEAN") {
        if (typeof s2.boolean !== "boolean") err("INVALID_VALUE", p, s2.optionKey);
        return;
      }
      const codes = s2.valueCodes ?? [];
      if (codes.length === 0) return err("INVALID_VALUE", p, s2.optionKey);
      if (io.selectionMode === "SINGLE" && codes.length > 1) {
        return err("TOO_MANY_VALUES", p, s2.optionKey);
      }
      const allowed = ix.allowedValues.get(`${item.id}:${def.id}`) ?? /* @__PURE__ */ new Set();
      const ids = /* @__PURE__ */ new Set();
      for (const code of codes) {
        const v = ix.optionValueByCode.get(`${def.id}:${code}`);
        if (!v || !v.isActive || !allowed.has(v.id)) {
          err("INVALID_VALUE", p, `${s2.optionKey}=${code}`);
          continue;
        }
        ids.add(v.id);
      }
      out.set(def.id, ids);
    });
    return out;
  };
  const common = resolveSelections(req.selections ?? [], "selections", false);
  const rows2 = [];
  if (req.distribution && req.distribution.length > 0) {
    let sum = 0;
    req.distribution.forEach((row, i) => {
      if (!isPositiveInt(row.quantity)) err("INVALID_QUANTITY", `distribution[${i}].quantity`);
      sum += row.quantity;
      const values = resolveSelections(row.selections, `distribution[${i}].selections`, true);
      for (const defId of values.keys()) {
        if (common.has(defId)) {
          err("DUPLICATE_OPTION", `distribution[${i}]`, ix.optionDefById.get(defId)?.key);
        }
      }
      rows2.push({ quantity: row.quantity, values: new Map([...common, ...values]) });
    });
    if (sum !== req.quantity)
      err("DISTRIBUTION_QTY_MISMATCH", "distribution", `${sum}\u2260${req.quantity}`);
  } else {
    rows2.push({ quantity: req.quantity, values: common });
  }
  for (const io of itemOptions.filter((o) => o.isRequired)) {
    const key = ix.optionDefById.get(io.optionDefinitionId)?.key ?? io.optionDefinitionId;
    rows2.forEach((r, i) => {
      if (!r.values.has(io.optionDefinitionId)) {
        err("MISSING_OPTION", rows2.length > 1 ? `distribution[${i}]` : "selections", key);
      }
    });
  }
  let measurements = null;
  if (item.measurementSpec) {
    const m = req.measurements;
    const spec = item.measurementSpec;
    const ok = m !== void 0 && (spec.kind === "AREA" ? (m.width ?? 0) > 0 && (m.height ?? 0) > 0 : (m.length ?? 0) > 0);
    if (!ok) err("MEASUREMENT_REQUIRED", "measurements", spec.kind);
    else measurements = m;
  } else if (req.measurements) {
    err("MEASUREMENT_NOT_ALLOWED", "measurements");
  }
  const decorations = [...req.decorations ?? []];
  const decorationMethodIds = [];
  if (item.decorationPolicy === "NONE" && decorations.length > 0) {
    err("DECORATION_NOT_ALLOWED", "decorations");
    decorations.length = 0;
  }
  if (item.decorationPolicy === "REQUIRED" && decorations.length === 0) {
    err("DECORATION_REQUIRED", "decorations");
  }
  decorations.forEach((d, i) => {
    const method = ix.methodByKey.get(d.methodKey);
    if (!method || !method.isActive) return err("UNKNOWN_METHOD", `decorations[${i}]`, d.methodKey);
    if (!ix.capabilities.has(`${item.id}:${method.id}`)) {
      return err("METHOD_NOT_COMPATIBLE", `decorations[${i}]`, d.methodKey);
    }
    decorationMethodIds.push(method.id);
  });
  const optionalLines = optionalChildrenOf(item.id, ix.snapshot.compositionLines);
  const optionalComponents = [];
  (req.optionalComponents ?? []).forEach((c, i) => {
    const line = optionalLines.find((l) => l.childItemId === c.catalogItemId);
    const child = ix.itemById.get(c.catalogItemId);
    if (!line || !child) return err("OPTIONAL_COMPONENT_NOT_ALLOWED", `optionalComponents[${i}]`);
    if (child.status !== "ACTIVE") {
      return err("OPTIONAL_COMPONENT_NOT_ACTIVE", `optionalComponents[${i}]`, child.publicCode);
    }
    const qty = c.quantity ?? line.quantity * req.quantity;
    if (!isPositiveInt(qty)) return err("INVALID_QUANTITY", `optionalComponents[${i}].quantity`);
    optionalComponents.push({ item: child, quantity: qty });
  });
  if (errors.length > 0 || !market) return { ok: false, errors };
  return {
    ok: true,
    config: {
      item,
      marketId: market.id,
      quantity: req.quantity,
      common,
      rows: rows2,
      decorationMethodIds,
      measurements,
      optionalComponents
    }
  };
}

// product-engine/src/domain/market.ts
function fxParameterKey(from, to) {
  return `${from.toLowerCase()}_${to.toLowerCase()}_fx`;
}
function isEffective(validFrom, validTo, asOf) {
  const t = asOf.getTime();
  if (Date.parse(validFrom) > t) return false;
  return validTo === null || Date.parse(validTo) > t;
}
function effectiveMarketMode(priceBook, policy) {
  const requested = policy?.pricingMode ?? "INHERIT";
  if (requested === "QUOTE_ONLY") return { mode: "QUOTE_ONLY", priceBook };
  if (requested === "MANUAL") {
    return { mode: priceBook.mode === "MASTER" ? "MASTER" : "MANUAL", priceBook };
  }
  if (priceBook.mode === "MASTER") {
    if (requested === "DERIVED") {
      return { mode: "MISCONFIGURED", priceBook, detail: "DERIVED policy on a MASTER price book" };
    }
    return { mode: "MASTER", priceBook };
  }
  const override = policy?.factorOverride ?? null;
  return {
    mode: "DERIVED",
    priceBook,
    factor: override ?? priceBook.defaultFactor,
    factorSource: override !== null ? "ITEM" : "DEFAULT"
  };
}

// product-engine/src/domain/snapshot.ts
function group(rows2, key) {
  const m = /* @__PURE__ */ new Map();
  for (const r of rows2) m.set(key(r), [...m.get(key(r)) ?? [], r]);
  return m;
}
function indexSnapshot(s2) {
  const allowedValues = /* @__PURE__ */ new Map();
  for (const v of s2.itemOptionValues) {
    if (!v.isActive) continue;
    const k = `${v.itemId}:${v.optionDefinitionId}`;
    allowedValues.set(k, (allowedValues.get(k) ?? /* @__PURE__ */ new Set()).add(v.optionValueId));
  }
  return {
    snapshot: s2,
    itemById: new Map(s2.items.map((i) => [i.id, i])),
    optionDefById: new Map(s2.optionDefinitions.map((d) => [d.id, d])),
    optionDefByKey: new Map(s2.optionDefinitions.map((d) => [d.key, d])),
    optionValueById: new Map(s2.optionValues.map((v) => [v.id, v])),
    optionValueByCode: new Map(s2.optionValues.map((v) => [`${v.optionDefinitionId}:${v.code}`, v])),
    itemOptionsByItem: group(s2.itemOptions, (o) => o.itemId),
    allowedValues,
    methodByKey: new Map(s2.decorationMethods.map((m) => [m.key, m])),
    methodById: new Map(s2.decorationMethods.map((m) => [m.id, m])),
    capabilities: new Set(s2.decorationCapabilities.map((c) => `${c.itemId}:${c.methodId}`)),
    marketByCode: new Map(s2.markets.map((m) => [m.code, m])),
    bookByMarketId: new Map(s2.priceBooks.map((b) => [b.marketId, b])),
    bookById: new Map(s2.priceBooks.map((b) => [b.id, b])),
    policyByItemMarket: new Map(s2.itemMarketPolicies.map((p) => [`${p.itemId}:${p.marketId}`, p]))
  };
}

// product-engine/src/shared/money.ts
import Decimal from "decimal.js";
var CURRENCY_CODES = ["USD", "MXN"];
var Dec = Decimal.clone({ precision: 40, rounding: Decimal.ROUND_HALF_UP });
function isCurrencyCode(value) {
  return typeof value === "string" && CURRENCY_CODES.includes(value);
}
var MoneyError = class extends Error {
  name = "MoneyError";
};
function toDecimal(value) {
  let d;
  try {
    d = new Dec(value);
  } catch {
    throw new MoneyError(`Invalid decimal amount: ${String(value)}`);
  }
  if (!d.isFinite()) throw new MoneyError(`Amount must be finite: ${String(value)}`);
  return d;
}
function money(amount, currency) {
  if (!isCurrencyCode(currency)) {
    throw new MoneyError(`Money requires an explicit currency (got ${String(currency)})`);
  }
  return Object.freeze({ amount: toDecimal(amount), currency });
}
function assertSameCurrency(a, b) {
  if (a.currency !== b.currency) {
    throw new MoneyError(`Currency mismatch: ${a.currency} vs ${b.currency}`);
  }
}
function addMoney(a, b) {
  assertSameCurrency(a, b);
  return money(a.amount.plus(b.amount), a.currency);
}
function sumMoney(items, currency) {
  return items.reduce((acc, m) => addMoney(acc, m), money(0, currency));
}
function multiplyMoney(m, factor) {
  return money(m.amount.times(toDecimal(factor)), m.currency);
}
function roundMoney(m, dp = 2) {
  return money(m.amount.toDecimalPlaces(dp, Decimal.ROUND_HALF_UP), m.currency);
}
function convertMoney(source, target, factors) {
  const amount = factors.reduce((acc, f) => acc.times(toDecimal(f)), source.amount);
  return money(amount, target);
}
function formatAmount(m, dp = 2) {
  return m.amount.toFixed(dp);
}

// product-engine/src/pricing/resolve.ts
function resolvePrice(request, snapshot, asOf) {
  if (!(asOf instanceof Date) || Number.isNaN(asOf.getTime())) {
    throw new TypeError("resolvePrice requires an explicit, valid `asOf` instant");
  }
  return resolveWithIndex(request, indexSnapshot(snapshot), asOf, 0);
}
var MAX_COMPONENT_DEPTH = 1;
function resolveWithIndex(req, ix, asOf, depth) {
  const market = ix.marketByCode.get(req.market);
  const book = market ? ix.bookByMarketId.get(market.id) : void 0;
  const common = {
    catalogItemId: req.catalogItemId,
    market: req.market,
    quantity: req.quantity,
    currency: book?.currency ?? null,
    policy: null,
    effectiveAt: asOf.toISOString(),
    revisions: ix.snapshot.revisions,
    explanation: []
  };
  const validation = validateConfiguration(req, ix);
  if (!validation.ok) {
    return {
      ...common,
      status: "INVALID",
      errors: validation.errors,
      explanation: validation.errors.map((e) => `Configuraci\xF3n inv\xE1lida: ${e.code} en ${e.path}`)
    };
  }
  const cfg = validation.config;
  if (!book) {
    return ambiguous(common, "POLICY_MISCONFIGURED", [], `Sin price book para ${req.market}`);
  }
  const policy = ix.policyByItemMarket.get(`${cfg.item.id}:${cfg.marketId}`);
  const eff = effectiveMarketMode(book, policy);
  const basis = eff.mode === "QUOTE_ONLY" ? "POLICY_QUOTE_ONLY" : eff.mode === "MISCONFIGURED" ? "MASTER" : eff.mode;
  common.policy = {
    market: req.market,
    priceBookCode: book.code,
    basis,
    ...eff.mode === "DERIVED" ? { factor: eff.factor, factorSource: eff.factorSource } : {}
  };
  if (eff.mode === "MISCONFIGURED") {
    return ambiguous(common, "POLICY_MISCONFIGURED", [cfg.item.id], eff.detail);
  }
  if (eff.mode === "QUOTE_ONLY") {
    return quote(
      common,
      "MARKET_POLICY_QUOTE_ONLY",
      null,
      [],
      [],
      [`${cfg.item.canonicalName}: pol\xEDtica de mercado ${req.market} = s\xF3lo cotizaci\xF3n.`]
    );
  }
  let outcome;
  let derivation = null;
  const explanation = [];
  if (eff.mode === "MASTER" || eff.mode === "MANUAL") {
    outcome = priceInBook(cfg, book, ix, asOf);
    if (eff.mode === "MANUAL" && outcome.kind === "quote" && isMissingPrice(outcome.reason)) {
      outcome = {
        ...outcome,
        reason: "MANUAL_MX_PRICE_MISSING",
        detail: `${outcome.reason}: pol\xEDtica MANUAL sin precio manual para esta configuraci\xF3n; no se deriva`
      };
    }
    if (eff.mode === "MANUAL" && outcome.kind === "ok") {
      const missing = rulesMissingInBook(cfg, book, ix, asOf);
      if (missing.length > 0) {
        outcome = {
          kind: "quote",
          reason: "RULE_NOT_DEFINED_FOR_MARKET",
          detail: missing.join(", "),
          knownLines: outcome.lines,
          knownAdjustments: []
        };
      }
    }
  } else {
    const source = ix.bookById.get(eff.priceBook.sourcePriceBookId);
    if (!source) {
      return ambiguous(common, "POLICY_MISCONFIGURED", [book.id], "Price book fuente inexistente");
    }
    const src = priceInBook(cfg, source, ix, asOf);
    if (src.kind !== "ok") {
      outcome = src;
    } else {
      const fx = pickParameter(
        ix.snapshot.pricingParameters,
        fxParameterKey(source.currency, book.currency),
        asOf
      );
      if (fx.kind === "missing") {
        outcome = {
          kind: "quote",
          reason: "FX_PARAMETER_MISSING",
          detail: fx.key,
          knownLines: src.lines,
          knownAdjustments: []
        };
      } else if (fx.kind === "overlap") {
        outcome = {
          kind: "ambiguous",
          reason: "FX_PARAMETER_OVERLAP",
          ids: fx.ids,
          detail: fx.key
        };
      } else {
        const sourceTotal = roundMoney(src.total);
        const derivedTotal = roundMoney(
          convertMoney(sourceTotal, book.currency, [eff.factor, fx.parameter.value])
        );
        derivation = {
          sourcePriceBookCode: source.code,
          sourceTotal,
          factor: eff.factor,
          factorSource: eff.factorSource,
          fx: fx.parameter.value,
          fxParameterId: fx.parameter.id,
          rounding: "HALF_UP_2",
          derivedTotal
        };
        outcome = {
          kind: "ok",
          total: derivedTotal,
          rules: src.rules,
          lines: [
            ...src.lines,
            {
              kind: "MARKET_DERIVATION",
              label: `${source.currency} ${sourceTotal.amount.toFixed(2)} \xD7 factor ${eff.factor} \xD7 FX ${fx.parameter.value}`,
              quantity: cfg.quantity,
              amount: derivedTotal,
              source: { catalogItemId: cfg.item.id, basis: "DERIVED" }
            }
          ]
        };
        explanation.push(
          `Precio ${req.market} derivado: ${sourceTotal.amount.toFixed(2)} ${source.currency} \xD7 ${eff.factor} (${eff.factorSource === "ITEM" ? "factor del producto" : "factor default"}) \xD7 ${fx.parameter.value} = ${derivedTotal.amount.toFixed(2)} ${book.currency}.`
        );
      }
    }
  }
  if (outcome.kind === "ambiguous") {
    return ambiguous(common, outcome.reason, outcome.ids, outcome.detail);
  }
  if (outcome.kind === "quote") {
    return quote(
      common,
      outcome.reason,
      outcome.detail,
      outcome.knownLines,
      outcome.knownAdjustments,
      [
        ...explainQuote(cfg.item, outcome.reason, outcome.detail),
        ...outcome.knownAdjustments.map(
          (a) => `Aplicar\xEDa ${a.label}: ${a.quantity} unidad(es) = +${a.amount?.amount.toFixed(2)} ${a.amount?.currency} (informativo, no se suma).`
        )
      ]
    );
  }
  const components = [];
  const lines = [...outcome.lines];
  let total = outcome.total;
  for (const oc of cfg.optionalComponents) {
    if (depth >= MAX_COMPONENT_DEPTH) break;
    const child = resolveWithIndex(
      { catalogItemId: oc.item.id, market: req.market, quantity: oc.quantity },
      ix,
      asOf,
      depth + 1
    );
    if (child.status === "INVALID") {
      return {
        ...common,
        status: "INVALID",
        errors: child.errors.map((e) => ({
          ...e,
          path: `optionalComponents(${oc.item.publicCode}).${e.path}`
        })),
        explanation: child.explanation
      };
    }
    if (child.status === "AMBIGUOUS") {
      return ambiguous(
        common,
        child.reasonCode,
        child.conflictingIds,
        `componente ${oc.item.publicCode}: ${child.detail ?? ""}`
      );
    }
    if (child.status === "QUOTE_ONLY") {
      return quote(
        common,
        "COMPONENT_NOT_PRICED",
        `${oc.item.publicCode}: ${child.reasonCode}`,
        lines,
        [],
        [
          `El componente opcional ${oc.item.canonicalName} no tiene precio resoluble (${child.reasonCode}); no se inventa el total.`
        ]
      );
    }
    components.push({ catalogItemId: oc.item.id, quantity: oc.quantity, result: child });
    lines.push({
      kind: "COMPONENT_OPTIONAL",
      label: oc.item.canonicalName,
      quantity: oc.quantity,
      amount: child.total,
      source: { catalogItemId: oc.item.id, basis: child.policy?.basis ?? "MASTER" }
    });
    total = addMoney(total, child.total);
  }
  const currency = book.currency;
  return {
    ...common,
    status: "RESOLVED",
    currency,
    total: roundMoney(total),
    breakdown: lines,
    rulesApplied: outcome.rules,
    derivation,
    components,
    explanation: [
      `${cfg.item.canonicalName} \xD7 ${cfg.quantity}: total ${roundMoney(total).amount.toFixed(2)} ${currency}.`,
      ...explanation
    ]
  };
}
function priceInBook(cfg, book, ix, asOf) {
  const currency = book.currency;
  const methods = new Set(cfg.decorationMethodIds);
  const ruleEval = evaluateRules(cfg, book, ix, asOf, methods);
  if (ruleEval.kind === "ambiguous") return ruleEval;
  const { adjustments, applied, requireQuote } = ruleEval;
  if (requireQuote) {
    return {
      kind: "quote",
      reason: "RULE_REQUIRES_QUOTE",
      detail: requireQuote,
      knownLines: [],
      knownAdjustments: adjustments
    };
  }
  if (cfg.item.saleUnit === null) {
    return {
      kind: "quote",
      reason: "NO_SALE_UNIT",
      detail: null,
      knownLines: [],
      knownAdjustments: adjustments
    };
  }
  const baseDefs = candidateDefinitions(
    ix,
    cfg.item.id,
    book.id,
    "ITEM",
    asOf,
    cfg.common,
    /* @__PURE__ */ new Set()
  );
  const base = pickMostSpecific(baseDefs);
  if (base.kind === "none") {
    return {
      kind: "quote",
      reason: "NO_AUTHORIZED_BASE_PRICE",
      detail: null,
      knownLines: [],
      knownAdjustments: adjustments
    };
  }
  if (base.kind === "tie") {
    return { kind: "ambiguous", reason: "BASE_DEFINITION_OVERLAP", ids: base.ids, detail: null };
  }
  const baseAmount = evaluateModel(base.def, cfg, currency);
  if (baseAmount.kind !== "ok") {
    return baseAmount.kind === "quote" ? {
      kind: "quote",
      reason: baseAmount.reason,
      detail: baseAmount.detail,
      knownLines: [],
      knownAdjustments: adjustments
    } : {
      kind: "ambiguous",
      reason: "DEFINITION_MISCONFIGURED",
      ids: [base.def.id],
      detail: baseAmount.detail
    };
  }
  const lines = [
    {
      kind: "BASE",
      label: cfg.item.canonicalName,
      quantity: cfg.quantity,
      amount: baseAmount.amount,
      source: {
        catalogItemId: cfg.item.id,
        priceDefinitionId: base.def.id,
        priceDefinitionVersion: base.def.version,
        ...baseAmount.breakQuantity !== void 0 ? { breakQuantity: baseAmount.breakQuantity } : {}
      }
    }
  ];
  for (const methodId of cfg.decorationMethodIds) {
    const method = ix.methodById.get(methodId);
    const defs = candidateDefinitions(
      ix,
      cfg.item.id,
      book.id,
      "DECORATION",
      asOf,
      cfg.common,
      /* @__PURE__ */ new Set([methodId])
    ).filter(
      (d) => d.conditions.some((c) => c.kind === "DECORATION_METHOD" && c.decorationMethodId === methodId)
    );
    const pick = pickMostSpecific(defs);
    if (pick.kind === "none") {
      return {
        kind: "quote",
        reason: "NO_AUTHORIZED_DECORATION_PRICE",
        detail: method?.key ?? methodId,
        knownLines: lines,
        knownAdjustments: adjustments
      };
    }
    if (pick.kind === "tie") {
      return {
        kind: "ambiguous",
        reason: "DECORATION_DEFINITION_OVERLAP",
        ids: pick.ids,
        detail: method?.key ?? null
      };
    }
    const amt = evaluateModel(pick.def, cfg, currency);
    if (amt.kind !== "ok") {
      return amt.kind === "quote" ? {
        kind: "quote",
        reason: amt.reason,
        detail: `decoraci\xF3n ${method?.key}: ${amt.detail ?? ""}`,
        knownLines: lines,
        knownAdjustments: adjustments
      } : {
        kind: "ambiguous",
        reason: "DEFINITION_MISCONFIGURED",
        ids: [pick.def.id],
        detail: amt.detail
      };
    }
    lines.push({
      kind: "DECORATION",
      label: `Decoraci\xF3n ${method?.name ?? methodId}`,
      quantity: cfg.quantity,
      amount: amt.amount,
      source: {
        priceDefinitionId: pick.def.id,
        priceDefinitionVersion: pick.def.version,
        ...amt.breakQuantity !== void 0 ? { breakQuantity: amt.breakQuantity } : {}
      }
    });
  }
  for (const l of includedChildrenOf(cfg.item.id, ix.snapshot.compositionLines)) {
    const child = ix.itemById.get(l.childItemId);
    lines.push({
      kind: "COMPONENT_INCLUDED",
      label: child?.canonicalName ?? l.childItemId,
      quantity: l.quantity * cfg.quantity,
      amount: null,
      source: { catalogItemId: l.childItemId }
    });
  }
  lines.push(...adjustments);
  const priced = lines.filter((l) => l.amount !== null).map((l) => l.amount);
  return { kind: "ok", total: sumMoney(priced, currency), lines, rules: applied };
}
function isMissingPrice(reason) {
  return reason === "NO_AUTHORIZED_BASE_PRICE" || reason === "QUANTITY_NOT_IN_MATRIX" || reason === "NO_AUTHORIZED_DECORATION_PRICE" || reason === "FIXED_PRICE_QUANTITY_NOT_AUTHORIZED";
}
function isLive(status, validFrom, validTo, asOf) {
  return (status === "AUTHORIZED" || status === "SUPERSEDED") && isEffective(validFrom, validTo, asOf);
}
function conditionsMatch(conditions, values, methods) {
  const byOption = /* @__PURE__ */ new Map();
  const methodConds = /* @__PURE__ */ new Set();
  for (const c of conditions) {
    if (c.kind === "OPTION_VALUE") {
      byOption.set(
        c.optionDefinitionId,
        (byOption.get(c.optionDefinitionId) ?? /* @__PURE__ */ new Set()).add(c.optionValueId)
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
function specificity(conditions) {
  const keys = new Set(
    conditions.map(
      (c) => c.kind === "OPTION_VALUE" ? `o:${c.optionDefinitionId}` : `m:${c.decorationMethodId}`
    )
  );
  return keys.size;
}
function candidateDefinitions(ix, itemId, bookId, component, asOf, values, methods) {
  return ix.snapshot.priceDefinitions.filter(
    (d) => d.itemId === itemId && d.priceBookId === bookId && d.component === component && isLive(d.status, d.validFrom, d.validTo, asOf) && conditionsMatch(d.conditions, values, methods)
  );
}
function pickMostSpecific(defs) {
  if (defs.length === 0) return { kind: "none" };
  const top = Math.max(...defs.map((d) => specificity(d.conditions)));
  const best = defs.filter((d) => specificity(d.conditions) === top);
  if (best.length > 1) return { kind: "tie", ids: best.map((d) => d.id) };
  return { kind: "one", def: best[0] };
}
function evaluateModel(def, cfg, currency) {
  const qty = cfg.quantity;
  switch (def.model) {
    case "FIXED":
      if (qty > def.maxQuantity) {
        return {
          kind: "quote",
          reason: "FIXED_PRICE_QUANTITY_NOT_AUTHORIZED",
          detail: `m\xE1ximo ${def.maxQuantity}`
        };
      }
      return { kind: "ok", amount: money(def.amount, currency) };
    case "PER_UNIT":
      if (def.minQuantity !== null && qty < def.minQuantity) {
        return { kind: "quote", reason: "BELOW_MIN_QUANTITY", detail: `m\xEDnimo ${def.minQuantity}` };
      }
      if (def.maxQuantity !== null && qty > def.maxQuantity) {
        return { kind: "quote", reason: "ABOVE_MAX_QUANTITY", detail: `m\xE1ximo ${def.maxQuantity}` };
      }
      return { kind: "ok", amount: multiplyMoney(money(def.amount, currency), qty) };
    case "EXACT_QUANTITY_MATRIX": {
      const hit = def.breaks.find((b) => b.quantity === qty);
      if (!hit) {
        const available = def.breaks.map((b) => b.quantity).sort((a, b) => a - b).join(", ");
        return {
          kind: "quote",
          reason: "QUANTITY_NOT_IN_MATRIX",
          detail: `cantidad ${qty}; disponibles: ${available}`
        };
      }
      const unit = money(hit.amount, currency);
      return {
        kind: "ok",
        amount: hit.amountBasis === "TOTAL" ? unit : multiplyMoney(unit, qty),
        breakQuantity: hit.quantity
      };
    }
    case "TIERED": {
      const tier = [...def.breaks].sort((a, b) => b.quantity - a.quantity).find((b) => b.quantity <= qty);
      if (!tier) return { kind: "quote", reason: "BELOW_MIN_QUANTITY", detail: null };
      const unit = money(tier.amount, currency);
      return {
        kind: "ok",
        amount: tier.amountBasis === "TOTAL" ? unit : multiplyMoney(unit, qty),
        breakQuantity: tier.quantity
      };
    }
    case "MEASURED": {
      const spec = cfg.item.measurementSpec;
      const m = cfg.measurements;
      if (!spec || !m) return { kind: "misconfigured", detail: "MEASURED sin measurement_spec" };
      const toFt = (v) => m.unit === "in" ? toDecimal(v).dividedBy(12) : toDecimal(v);
      let measure;
      if (def.rateUnit === "SQ_FT" && spec.kind === "AREA") {
        measure = toFt(m.width ?? 0).times(toFt(m.height ?? 0));
      } else if (def.rateUnit === "LINEAR_FT" && spec.kind === "LENGTH") {
        measure = toFt(m.length ?? 0);
      } else {
        return {
          kind: "misconfigured",
          detail: `rate_unit ${def.rateUnit} incompatible con ${spec.kind}`
        };
      }
      let amount = money(toDecimal(def.rate).times(measure).times(qty), currency);
      if (def.minCharge !== null && amount.amount.lessThan(toDecimal(def.minCharge))) {
        amount = money(def.minCharge, currency);
      }
      return { kind: "ok", amount };
    }
  }
}
function liveRulesFor(itemId, bookId, ix, asOf) {
  return ix.snapshot.priceRules.filter(
    (r) => r.priceBookId === bookId && r.itemIds.includes(itemId) && isLive(r.status, r.validFrom, r.validTo, asOf)
  );
}
function evaluateRules(cfg, book, ix, asOf, methods) {
  const rules = liveRulesFor(cfg.item.id, book.id, ix, asOf);
  const perRuleQty = /* @__PURE__ */ new Map();
  let requireQuote = null;
  for (const row of cfg.rows) {
    const matched = rules.filter((r) => conditionsMatch(r.conditions, row.values, methods));
    const groups = /* @__PURE__ */ new Map();
    for (const r of matched) {
      const key = r.exclusivityKey ?? `rule:${r.id}`;
      groups.set(key, [...groups.get(key) ?? [], r]);
    }
    for (const [key, group2] of groups) {
      const distinct = new Set(group2.map((r2) => `${r2.kind}:${r2.amount ?? ""}`));
      if (distinct.size > 1) {
        return {
          kind: "ambiguous",
          reason: "RULE_CONFLICT",
          ids: group2.map((r2) => r2.id),
          detail: key
        };
      }
      const r = group2[0];
      if (r.kind === "REQUIRE_QUOTE") requireQuote = r.code;
      const prev = perRuleQty.get(r.id);
      perRuleQty.set(r.id, { rule: r, qty: (prev?.qty ?? 0) + row.quantity });
    }
  }
  const adjustments = [];
  const applied = [];
  for (const { rule, qty } of perRuleQty.values()) {
    applied.push({ ruleId: rule.id, code: rule.code, version: rule.version });
    if (rule.kind === "REQUIRE_QUOTE" || rule.amount === null) continue;
    const unit = money(rule.amount, book.currency);
    adjustments.push({
      kind: "RULE",
      label: rule.label,
      quantity: rule.kind === "ADD_PER_UNIT" ? qty : 1,
      amount: rule.kind === "ADD_PER_UNIT" ? multiplyMoney(unit, qty) : unit,
      source: { ruleId: rule.id, ruleCode: rule.code, ruleVersion: rule.version }
    });
  }
  return { kind: "ok", adjustments, applied, requireQuote };
}
function rulesMissingInBook(cfg, book, ix, asOf) {
  if (book.mode !== "DERIVED") return [];
  const methods = new Set(cfg.decorationMethodIds);
  const matchedCodes = (bookId) => new Set(
    liveRulesFor(cfg.item.id, bookId, ix, asOf).filter((r) => cfg.rows.some((row) => conditionsMatch(r.conditions, row.values, methods))).map((r) => r.code)
  );
  const here = matchedCodes(book.id);
  return [...matchedCodes(book.sourcePriceBookId)].filter((c) => !here.has(c));
}
function pickParameter(params, key, asOf) {
  const live = params.filter((p) => p.key === key && isEffective(p.validFrom, p.validTo, asOf));
  if (live.length === 0) return { kind: "missing", key };
  if (live.length > 1) return { kind: "overlap", key, ids: live.map((p) => p.id) };
  return { kind: "one", parameter: live[0] };
}
function quote(common, reason, detail, knownLines, knownAdjustments, explanation) {
  return {
    ...common,
    status: "QUOTE_ONLY",
    reasonCode: reason,
    detail,
    knownLines,
    knownAdjustments,
    explanation
  };
}
function ambiguous(common, reason, ids, detail) {
  return {
    ...common,
    status: "AMBIGUOUS",
    reasonCode: reason,
    conflictingIds: ids,
    detail,
    explanation: [`Defecto de datos del cat\xE1logo (${reason}); tratar como cotizaci\xF3n manual.`]
  };
}
function explainQuote(item, reason, detail) {
  const d = detail ? ` (${detail})` : "";
  switch (reason) {
    case "NO_AUTHORIZED_BASE_PRICE":
      return [`No existe precio base autorizado para ${item.canonicalName}; requiere cotizaci\xF3n.`];
    case "QUANTITY_NOT_IN_MATRIX":
      return [`La cantidad no est\xE1 en la matriz de cantidades exactas${d}; no se interpola.`];
    default:
      return [`${item.canonicalName}: requiere cotizaci\xF3n \u2014 ${reason}${d}.`];
  }
}

// product-engine/src/api/contracts.ts
import { z } from "zod";
var CurrencyCodeSchema = z.enum(CURRENCY_CODES);
var MarketCodeSchema = z.enum(["USA", "MX"]);
var MoneyWireSchema = z.object({
  amount: z.string().regex(/^-?\d+\.\d{2}$/, "decimal string with 2 decimals"),
  currency: CurrencyCodeSchema
}).strict();
var OptionSelectionWire = z.object({
  option_key: z.string().min(1),
  value_codes: z.array(z.string().min(1)).min(1).optional(),
  text: z.string().optional(),
  boolean: z.boolean().optional()
}).strict();
var PositiveInt = z.number().int().positive();
var PriceRequestSchema = z.object({
  catalog_item_id: z.uuid(),
  market: MarketCodeSchema,
  quantity: PositiveInt,
  selections: z.array(OptionSelectionWire).optional(),
  distribution: z.array(z.object({ selections: z.array(OptionSelectionWire), quantity: PositiveInt }).strict()).optional(),
  measurements: z.object({
    width: z.number().positive().optional(),
    height: z.number().positive().optional(),
    length: z.number().positive().optional(),
    unit: z.enum(["in", "ft"])
  }).strict().optional(),
  decorations: z.array(
    z.object({
      method_key: z.string().min(1),
      placement_code: z.string().optional(),
      print_size_code: z.string().optional()
    }).strict()
  ).optional(),
  optional_components: z.array(z.object({ catalog_item_id: z.uuid(), quantity: PositiveInt.optional() }).strict()).optional()
}).strict();
var toSelection = (s2) => ({
  optionKey: s2.option_key,
  ...s2.value_codes ? { valueCodes: s2.value_codes } : {},
  ...s2.text !== void 0 ? { text: s2.text } : {},
  ...s2.boolean !== void 0 ? { boolean: s2.boolean } : {}
});
function parsePriceRequest(input2) {
  const w = PriceRequestSchema.parse(input2);
  return {
    catalogItemId: w.catalog_item_id,
    market: w.market,
    quantity: w.quantity,
    ...w.selections ? { selections: w.selections.map(toSelection) } : {},
    ...w.distribution ? {
      distribution: w.distribution.map((r) => ({
        quantity: r.quantity,
        selections: r.selections.map(toSelection)
      }))
    } : {},
    ...w.measurements ? { measurements: w.measurements } : {},
    ...w.decorations ? {
      decorations: w.decorations.map((d) => ({
        methodKey: d.method_key,
        ...d.placement_code ? { placementCode: d.placement_code } : {},
        ...d.print_size_code ? { printSizeCode: d.print_size_code } : {}
      }))
    } : {},
    ...w.optional_components ? {
      optionalComponents: w.optional_components.map((c) => ({
        catalogItemId: c.catalog_item_id,
        ...c.quantity ? { quantity: c.quantity } : {}
      }))
    } : {}
  };
}
function moneyToWire(m) {
  return { amount: formatAmount(m), currency: m.currency };
}
var BreakdownLineWire = z.object({
  kind: z.enum([
    "BASE",
    "DECORATION",
    "RULE",
    "COMPONENT_INCLUDED",
    "COMPONENT_OPTIONAL",
    "MARKET_DERIVATION"
  ]),
  label: z.string(),
  quantity: z.number(),
  amount: MoneyWireSchema.nullable(),
  source: z.record(z.string(), z.union([z.string(), z.number()]))
});
var CommonWire = {
  catalog_item_id: z.uuid(),
  market: MarketCodeSchema,
  quantity: z.number(),
  currency: CurrencyCodeSchema.nullable(),
  policy: z.object({
    market: MarketCodeSchema,
    price_book_code: z.string(),
    basis: z.enum(["MASTER", "DERIVED", "MANUAL", "POLICY_QUOTE_ONLY"]),
    factor: z.string().optional(),
    factor_source: z.enum(["DEFAULT", "ITEM"]).optional()
  }).nullable(),
  effective_at: z.iso.datetime(),
  catalog_revision: z.number().int(),
  pricing_revision: z.number().int(),
  explanation: z.array(z.string())
};
var PriceResultWireSchema = z.discriminatedUnion("status", [
  z.object({
    ...CommonWire,
    status: z.literal("RESOLVED"),
    total: MoneyWireSchema,
    breakdown: z.array(BreakdownLineWire),
    rules_applied: z.array(z.object({ rule_id: z.uuid(), code: z.string(), version: z.number() })),
    derivation: z.object({
      source_price_book_code: z.string(),
      source_total: MoneyWireSchema,
      factor: z.string(),
      factor_source: z.enum(["DEFAULT", "ITEM"]),
      fx: z.string(),
      fx_parameter_id: z.uuid(),
      rounding: z.literal("HALF_UP_2"),
      derived_total: MoneyWireSchema
    }).nullable(),
    components: z.array(
      z.object({ catalog_item_id: z.uuid(), quantity: z.number(), total: MoneyWireSchema })
    )
  }),
  z.object({
    ...CommonWire,
    status: z.literal("QUOTE_ONLY"),
    reason_code: z.string(),
    detail: z.string().nullable(),
    known_lines: z.array(BreakdownLineWire),
    known_adjustments: z.array(BreakdownLineWire)
  }),
  z.object({
    ...CommonWire,
    status: z.literal("INVALID"),
    errors: z.array(
      z.object({ code: z.string(), path: z.string(), detail: z.string().optional() })
    )
  }),
  z.object({
    ...CommonWire,
    status: z.literal("AMBIGUOUS"),
    reason_code: z.string(),
    conflicting_ids: z.array(z.string()),
    detail: z.string().nullable()
  })
]);
var snake = (k) => k.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
function lineToWire(l) {
  const source = {};
  for (const [k, v] of Object.entries(l.source)) if (v !== void 0) source[snake(k)] = v;
  return {
    kind: l.kind,
    label: l.label,
    quantity: l.quantity,
    amount: l.amount ? moneyToWire(l.amount) : null,
    source
  };
}
function priceResultToWire(r) {
  const common = {
    catalog_item_id: r.catalogItemId,
    market: r.market,
    quantity: r.quantity,
    currency: r.currency,
    policy: r.policy ? {
      market: r.policy.market,
      price_book_code: r.policy.priceBookCode,
      basis: r.policy.basis,
      ...r.policy.factor !== void 0 ? { factor: r.policy.factor } : {},
      ...r.policy.factorSource !== void 0 ? { factor_source: r.policy.factorSource } : {}
    } : null,
    effective_at: r.effectiveAt,
    catalog_revision: r.revisions.catalog,
    pricing_revision: r.revisions.pricing,
    explanation: r.explanation
  };
  let wire;
  switch (r.status) {
    case "RESOLVED":
      wire = {
        ...common,
        status: r.status,
        total: moneyToWire(r.total),
        breakdown: r.breakdown.map(lineToWire),
        rules_applied: r.rulesApplied.map((a) => ({
          rule_id: a.ruleId,
          code: a.code,
          version: a.version
        })),
        derivation: r.derivation ? {
          source_price_book_code: r.derivation.sourcePriceBookCode,
          source_total: moneyToWire(r.derivation.sourceTotal),
          factor: r.derivation.factor,
          factor_source: r.derivation.factorSource,
          fx: r.derivation.fx,
          fx_parameter_id: r.derivation.fxParameterId,
          rounding: r.derivation.rounding,
          derived_total: moneyToWire(r.derivation.derivedTotal)
        } : null,
        components: r.components.map((c) => ({
          catalog_item_id: c.catalogItemId,
          quantity: c.quantity,
          total: moneyToWire(c.result.total)
        }))
      };
      break;
    case "QUOTE_ONLY":
      wire = {
        ...common,
        status: r.status,
        reason_code: r.reasonCode,
        detail: r.detail,
        known_lines: r.knownLines.map(lineToWire),
        known_adjustments: r.knownAdjustments.map(lineToWire)
      };
      break;
    case "INVALID":
      wire = { ...common, status: r.status, errors: r.errors };
      break;
    case "AMBIGUOUS":
      wire = {
        ...common,
        status: r.status,
        reason_code: r.reasonCode,
        conflicting_ids: r.conflictingIds,
        detail: r.detail
      };
      break;
  }
  return PriceResultWireSchema.parse(wire);
}

// product-engine/src/api/crm-catalog.ts
var isCrmVisible = (i) => i.status === "ACTIVE" && i.mergedIntoId === null;
var normalizeText = (v) => v.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
var readyFor = (input2, itemId) => input2.presentations.filter((p) => p.itemId === itemId && p.status === "READY");
function searchTerms(input2, itemId) {
  const own = input2.presentations.filter((p) => p.itemId === itemId);
  return {
    display: own.filter((p) => p.status === "READY").map((p) => normalizeText(p.displayName)),
    aliases: own.flatMap((p) => p.aliases.map(normalizeText))
  };
}
function defaultPresentation(item, input2) {
  const own = readyFor(input2, item.id);
  return own.find((p) => p.locale === "es" && p.isDefault) ?? own.find((p) => p.isDefault) ?? own.find((p) => p.locale === "es") ?? own[0];
}
function hasAuthorizedPrice(input2, itemId, bookId) {
  return input2.snapshot.priceDefinitions.some(
    (d) => d.itemId === itemId && d.priceBookId === bookId && d.status === "AUTHORIZED" && isEffective(d.validFrom, d.validTo, input2.asOf)
  );
}
function marketInfo(input2, item, market) {
  const idx = indexSnapshot(input2.snapshot);
  const m = idx.marketByCode.get(market);
  const book = m ? idx.bookByMarketId.get(m.id) : void 0;
  const none = (a, avail, cur) => ({
    market,
    is_available: avail,
    price_availability: a,
    currency: cur
  });
  if (!m || !book) return none("UNAVAILABLE", false, null);
  const policy = idx.policyByItemMarket.get(`${item.id}:${m.id}`);
  if (policy && !policy.isAvailable) return none("UNAVAILABLE", false, book.currency);
  const mode = effectiveMarketMode(book, policy);
  if (mode.mode === "QUOTE_ONLY" || mode.mode === "MISCONFIGURED") {
    return none("QUOTE_ONLY", true, book.currency);
  }
  const lookupBook = mode.mode === "DERIVED" ? mode.priceBook.sourcePriceBookId : book.id;
  const ids = [
    item.id,
    ...input2.snapshot.compositionLines.filter((l) => l.parentItemId === item.id && l.role === "INCLUDED").map((l) => l.childItemId)
  ];
  const priced = ids.some((id) => hasAuthorizedPrice(input2, id, lookupBook));
  return none(priced ? "AUTHORIZED_PRICES" : "QUOTE_ONLY", true, book.currency);
}
var MARKETS = ["USA", "MX"];
var marketsFor = (input2, item) => MARKETS.map((m) => marketInfo(input2, item, m));
function toSummary(input2, item) {
  const p = defaultPresentation(item, input2);
  return {
    id: item.id,
    public_code: item.publicCode,
    canonical_name: item.canonicalName,
    display_name: p?.displayName ?? item.canonicalName,
    item_type: item.kind,
    sale_unit: item.saleUnit,
    description: p?.shortDescription ?? null,
    markets: marketsFor(input2, item)
  };
}
function searchItems(input2, params) {
  const idx = indexSnapshot(input2.snapshot);
  const tokens = params.q ? normalizeText(params.q).split(" ").filter(Boolean) : [];
  const scored = [];
  for (const item of input2.snapshot.items) {
    if (!isCrmVisible(item)) continue;
    if (params.market) {
      const m = idx.marketByCode.get(params.market);
      const pol = m ? idx.policyByItemMarket.get(`${item.id}:${m.id}`) : void 0;
      if (!m || pol && !pol.isAvailable) continue;
    }
    const { display, aliases } = searchTerms(input2, item.id);
    const code = normalizeText(item.publicCode);
    const name = normalizeText(item.canonicalName);
    let rank = 0;
    if (tokens.length) {
      const q = tokens.join(" ");
      const hay = [code, name, ...display, ...aliases];
      if (!tokens.every((t) => hay.some((h) => h.includes(t)))) continue;
      rank = code === q ? 0 : code.startsWith(q) ? 1 : name.startsWith(q) || display.some((d) => d.startsWith(q)) ? 2 : tokens.every((t) => name.includes(t)) ? 3 : 4;
    }
    scored.push({ item, rank });
  }
  scored.sort(
    (a, b) => a.rank - b.rank || a.item.canonicalName.localeCompare(b.item.canonicalName, "es") || a.item.publicCode.localeCompare(b.item.publicCode)
  );
  const total = scored.length;
  const slice = scored.slice(params.offset, params.offset + params.limit);
  const next = params.offset + slice.length;
  return {
    items: slice.map((s2) => toSummary(input2, s2.item)),
    page: {
      limit: params.limit,
      offset: params.offset,
      total,
      next_offset: next < total ? next : null
    }
  };
}
function findVisibleItem(snapshot, idOrCode) {
  const key = idOrCode.trim();
  const found = snapshot.items.find(
    (i) => i.id === key.toLowerCase() || i.publicCode === key.toUpperCase()
  );
  return found && isCrmVisible(found) ? found : void 0;
}
function toDetail(input2, item) {
  const s2 = input2.snapshot;
  const idx = indexSnapshot(s2);
  const p = defaultPresentation(item, input2);
  const options = (idx.itemOptionsByItem.get(item.id) ?? []).flatMap((io) => {
    const def = idx.optionDefById.get(io.optionDefinitionId);
    return def && def.scope === "ITEM" ? [{ io, def }] : [];
  }).sort((a, b) => a.io.sort - b.io.sort || a.def.key.localeCompare(b.def.key)).map(({ io, def }) => {
    const allowed = s2.itemOptionValues.filter((v) => v.itemId === item.id && v.optionDefinitionId === def.id && v.isActive).sort((a, b) => a.sort - b.sort);
    const values = allowed.flatMap((v) => {
      const ov = idx.optionValueById.get(v.optionValueId);
      return ov && ov.isActive ? [{ code: ov.code, label: ov.label, spec: ov.spec }] : [];
    });
    const dflt = io.defaultValueId ? idx.optionValueById.get(io.defaultValueId) : void 0;
    return {
      key: def.key,
      label: def.label,
      value_kind: def.valueKind,
      unit: def.unit,
      is_required: io.isRequired,
      selection_mode: io.selectionMode,
      is_distributable: io.isDistributable,
      default_value_code: dflt?.code ?? null,
      values
    };
  });
  let decoration = null;
  if (item.decorationPolicy !== "NONE") {
    const methods = s2.decorationCapabilities.filter((c) => c.itemId === item.id).flatMap((c) => {
      const m = idx.methodById.get(c.methodId);
      if (!m || !m.isActive) return [];
      return [
        {
          key: m.key,
          name: m.name,
          allowed_placements: c.constraints?.allowedPlacements ?? null,
          max_print_size: c.constraints?.maxPrintSize ?? null
        }
      ];
    }).sort((a, b) => a.key.localeCompare(b.key));
    if (methods.length) decoration = { policy: item.decorationPolicy, methods };
  }
  const components = s2.compositionLines.filter((l) => l.parentItemId === item.id).sort((a, b) => a.sort - b.sort).flatMap((l) => {
    const child = idx.itemById.get(l.childItemId);
    if (!child || !isCrmVisible(child)) return [];
    return [
      {
        role: l.role,
        quantity: l.quantity,
        item: {
          id: child.id,
          public_code: child.publicCode,
          canonical_name: child.canonicalName
        }
      }
    ];
  });
  return {
    item: {
      id: item.id,
      public_code: item.publicCode,
      canonical_name: item.canonicalName,
      item_type: item.kind,
      status: "ACTIVE",
      description: p?.shortDescription ?? null,
      sale_unit: item.saleUnit,
      measurement: item.measurementSpec
    },
    presentations: readyFor(input2, item.id).sort((a, b) => a.locale.localeCompare(b.locale) || Number(b.isDefault) - Number(a.isDefault)).map((x) => ({
      locale: x.locale,
      display_name: x.displayName,
      occasion: x.occasion,
      short_description: x.shortDescription,
      is_default: x.isDefault
    })),
    options,
    decoration,
    components,
    markets: marketsFor(input2, item)
  };
}

// product-engine/src/api/crm-contracts.ts
import { z as z2 } from "zod";
var CONTRACT_VERSION = "1";
var CONTRACT_HEADER = "X-DTG-Contract-Version";
var PriceAvailabilitySchema = z2.enum(["AUTHORIZED_PRICES", "QUOTE_ONLY", "UNAVAILABLE"]);
var MarketAvailabilityWire = z2.object({
  market: MarketCodeSchema,
  is_available: z2.boolean(),
  /** Indicative only; `POST /pricing/resolve` is the authority. */
  price_availability: PriceAvailabilitySchema,
  currency: CurrencyCodeSchema.nullable()
}).strict();
var ItemSummaryWireSchema = z2.object({
  id: z2.uuid(),
  public_code: z2.string().regex(/^DTG-[0-9]{5,}$/),
  canonical_name: z2.string().min(1),
  display_name: z2.string().min(1),
  item_type: z2.enum(["PRODUCT", "SERVICE"]),
  sale_unit: z2.string().nullable(),
  description: z2.string().nullable(),
  markets: z2.array(MarketAvailabilityWire)
}).strict();
var ItemListResponseSchema = z2.object({
  contract_version: z2.literal(CONTRACT_VERSION),
  items: z2.array(ItemSummaryWireSchema),
  page: z2.object({
    limit: z2.number().int(),
    offset: z2.number().int(),
    total: z2.number().int(),
    next_offset: z2.number().int().nullable()
  }).strict()
}).strict();
var OptionValueWire = z2.object({
  code: z2.string(),
  label: z2.string(),
  spec: z2.union([
    z2.null(),
    z2.object({ w: z2.number(), h: z2.number() }),
    z2.object({ value: z2.number() })
  ])
}).strict();
var OptionWire = z2.object({
  key: z2.string(),
  label: z2.string(),
  value_kind: z2.enum(["ENUM", "TEXT", "BOOLEAN", "DIMENSIONS", "QUANTITY", "LENGTH"]),
  unit: z2.string().nullable(),
  is_required: z2.boolean(),
  selection_mode: z2.enum(["SINGLE", "MULTI"]),
  is_distributable: z2.boolean(),
  default_value_code: z2.string().nullable(),
  values: z2.array(OptionValueWire)
}).strict();
var ItemDetailResponseSchema = z2.object({
  contract_version: z2.literal(CONTRACT_VERSION),
  item: z2.object({
    id: z2.uuid(),
    public_code: z2.string(),
    canonical_name: z2.string(),
    item_type: z2.enum(["PRODUCT", "SERVICE"]),
    status: z2.literal("ACTIVE"),
    description: z2.string().nullable(),
    sale_unit: z2.string().nullable(),
    measurement: z2.object({ kind: z2.enum(["AREA", "LENGTH"]), unit: z2.enum(["in", "ft"]) }).strict().nullable()
  }).strict(),
  presentations: z2.array(
    z2.object({
      locale: z2.enum(["es", "en"]),
      display_name: z2.string(),
      occasion: z2.string().nullable(),
      short_description: z2.string().nullable(),
      is_default: z2.boolean()
    }).strict()
  ),
  options: z2.array(OptionWire),
  decoration: z2.object({
    policy: z2.enum(["OPTIONAL", "REQUIRED"]),
    methods: z2.array(
      z2.object({
        key: z2.string(),
        name: z2.string(),
        allowed_placements: z2.array(z2.string()).nullable(),
        max_print_size: z2.string().nullable()
      }).strict()
    )
  }).strict().nullable(),
  components: z2.array(
    z2.object({
      role: z2.enum(["INCLUDED", "OPTIONAL"]),
      quantity: z2.number().int(),
      item: z2.object({ id: z2.uuid(), public_code: z2.string(), canonical_name: z2.string() }).strict()
    }).strict()
  ),
  markets: z2.array(MarketAvailabilityWire)
}).strict();
var ResolveEnvelopeSchema = z2.object({
  as_of: z2.iso.datetime({ offset: true }).optional(),
  request: PriceRequestSchema
}).strict();
var ErrorResponseSchema = z2.object({
  error: z2.object({
    code: z2.enum([
      "INVALID_QUERY",
      "INVALID_JSON",
      "INVALID_REQUEST",
      "UNAUTHORIZED",
      "AUTH_NOT_CONFIGURED",
      "ITEM_NOT_FOUND",
      "METHOD_NOT_ALLOWED",
      "INTERNAL"
    ]),
    message: z2.string(),
    issues: z2.array(z2.object({ path: z2.string(), message: z2.string() }).strict()).optional()
  }).strict()
}).strict();
var ListQuerySchema = z2.object({
  q: z2.string().trim().max(100).optional(),
  market: MarketCodeSchema.optional(),
  limit: z2.coerce.number().int().min(1).max(50).default(20),
  offset: z2.coerce.number().int().min(0).max(1e5).default(0)
}).strict();

// product-engine/src/api/http.ts
import { timingSafeEqual } from "node:crypto";
var BASE_HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store",
  [CONTRACT_HEADER]: CONTRACT_VERSION
};
function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: BASE_HEADERS });
}
function errorResponse(status, code, message, issues) {
  const body = ErrorResponseSchema.parse({
    error: { code, message, ...issues ? { issues } : {} }
  });
  return jsonResponse(body, status);
}
var zodIssues = (e) => e.issues.slice(0, 20).map((i) => ({ path: i.path.join(".") || "(root)", message: i.message }));
function tokensFrom(env) {
  return (env.PRODUCT_ENGINE_API_TOKENS ?? "").split(",").map((t) => t.trim()).filter((t) => t.length >= 16);
}
var safeEqual = (a, b) => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};
function authorize(req, env = process.env) {
  const tokens = tokensFrom(env);
  if (tokens.length === 0) {
    return env.NODE_ENV === "production" ? errorResponse(503, "AUTH_NOT_CONFIGURED", "API tokens are not configured") : null;
  }
  const m = /^Bearer\s+(.+)$/i.exec(req.headers.get("authorization") ?? "");
  const given = m?.[1]?.trim() ?? "";
  if (given && tokens.some((t) => safeEqual(t, given))) return null;
  return errorResponse(401, "UNAUTHORIZED", "Missing or invalid bearer token");
}

// product-engine/src/api/crm-handlers.ts
async function input(deps, asOf) {
  const [snapshot, presentations] = await Promise.all([
    deps.loadSnapshot(),
    deps.loadPresentations()
  ]);
  return { snapshot, presentations, asOf };
}
function guard(req, deps) {
  return authorize(req, deps.env);
}
async function safely(fn) {
  try {
    return await fn();
  } catch (e) {
    console.error("[crm-api]", e);
    return errorResponse(500, "INTERNAL", "Unexpected server error");
  }
}
function listItems(req, deps) {
  return safely(async () => {
    const denied = guard(req, deps);
    if (denied) return denied;
    const url = new URL(req.url);
    const raw = {};
    for (const [k, v] of url.searchParams) {
      if (k in raw) return errorResponse(400, "INVALID_QUERY", `Duplicate query parameter "${k}"`);
      raw[k] = v;
    }
    const parsed = ListQuerySchema.safeParse(raw);
    if (!parsed.success) {
      return errorResponse(
        400,
        "INVALID_QUERY",
        "Invalid query parameters",
        zodIssues(parsed.error)
      );
    }
    const asOf = deps.now();
    const out = searchItems(await input(deps, asOf), {
      q: parsed.data.q || void 0,
      market: parsed.data.market,
      limit: parsed.data.limit,
      offset: parsed.data.offset
    });
    return jsonResponse(
      ItemListResponseSchema.parse({ contract_version: CONTRACT_VERSION, ...out })
    );
  });
}
function getItem(req, idOrCode, deps) {
  return safely(async () => {
    const denied = guard(req, deps);
    if (denied) return denied;
    if (!/^[0-9a-fA-F-]{36}$|^DTG-[0-9]{5,}$/i.test(idOrCode)) {
      return errorResponse(404, "ITEM_NOT_FOUND", "Item not found");
    }
    const inp = await input(deps, deps.now());
    const item = findVisibleItem(inp.snapshot, idOrCode);
    if (!item) return errorResponse(404, "ITEM_NOT_FOUND", "Item not found");
    return jsonResponse(
      ItemDetailResponseSchema.parse({
        contract_version: CONTRACT_VERSION,
        ...toDetail(inp, item)
      })
    );
  });
}
function resolve(req, deps) {
  return safely(async () => {
    const denied = guard(req, deps);
    if (denied) return denied;
    let body;
    try {
      body = await req.json();
    } catch {
      return errorResponse(400, "INVALID_JSON", "Body must be valid JSON");
    }
    let env;
    try {
      env = ResolveEnvelopeSchema.parse(body);
    } catch (e) {
      if (e instanceof ZodError) {
        return errorResponse(400, "INVALID_REQUEST", "Invalid pricing request", zodIssues(e));
      }
      throw e;
    }
    const asOf = env.as_of ? new Date(env.as_of) : deps.now();
    const snapshot = await deps.loadSnapshot();
    const domainReq = parsePriceRequest(env.request);
    const ids = [
      domainReq.catalogItemId,
      ...(domainReq.optionalComponents ?? []).map((c) => c.catalogItemId)
    ];
    if (!ids.every((id) => findVisibleItem(snapshot, id))) {
      return errorResponse(404, "ITEM_NOT_FOUND", "Item not found");
    }
    const wire = priceResultToWire(resolvePrice(domainReq, snapshot, asOf));
    return jsonResponse(wire);
  });
}

// product-engine/src/db/catalog-snapshot.ts
import Decimal2 from "decimal.js";
var iso = (v) => v instanceof Date ? v.toISOString() : new Date(String(v)).toISOString();
var isoOrNull = (v) => v === null || v === void 0 ? null : iso(v);
var canonicalDecimal = (v, minDp = 2) => {
  const d = new Decimal2(String(v));
  return d.toFixed(Math.max(d.decimalPlaces(), minDp));
};
var decOrNull = (v) => v === null || v === void 0 ? null : canonicalDecimal(v);
var s = (v) => v;
var n = (v) => Number(v);
async function rows(db, sql) {
  return (await db.query(sql)).rows;
}
function mapCondition(r) {
  return r.kind === "OPTION_VALUE" ? {
    id: s(r.id),
    kind: "OPTION_VALUE",
    optionDefinitionId: s(r.option_definition_id),
    optionValueId: s(r.option_value_id)
  } : { id: s(r.id), kind: "DECORATION_METHOD", decorationMethodId: s(r.decoration_method_id) };
}
function toDefinition(r, conditions, breaks) {
  const condFor = (field, id) => conditions.filter((c) => c[field] === id).map(mapCondition);
  const common = {
    id: s(r.id),
    itemId: s(r.item_id),
    priceBookId: s(r.price_book_id),
    component: r.component,
    status: r.status,
    validFrom: iso(r.valid_from),
    validTo: isoOrNull(r.valid_to),
    version: n(r.version),
    supersedesId: r.supersedes_id ?? null,
    authorizedBy: r.authorized_by ?? null,
    authorizedAt: isoOrNull(r.authorized_at),
    conditions: condFor("price_definition_id", s(r.id))
  };
  switch (r.model) {
    case "FIXED":
      return {
        ...common,
        model: "FIXED",
        amount: canonicalDecimal(r.amount),
        maxQuantity: n(r.max_quantity)
      };
    case "PER_UNIT":
      return {
        ...common,
        model: "PER_UNIT",
        amount: canonicalDecimal(r.amount),
        minQuantity: r.min_quantity === null ? null : n(r.min_quantity),
        maxQuantity: r.max_quantity === null ? null : n(r.max_quantity)
      };
    case "MEASURED":
      return {
        ...common,
        model: "MEASURED",
        rate: canonicalDecimal(r.rate),
        rateUnit: r.rate_unit,
        minCharge: decOrNull(r.min_charge)
      };
    default:
      return {
        ...common,
        model: r.model,
        breaks: breaks.filter((b) => b.price_definition_id === r.id).map((b) => ({
          quantity: n(b.quantity),
          amount: canonicalDecimal(b.amount),
          amountBasis: b.amount_basis
        }))
      };
  }
}
async function loadCatalogSnapshot(db) {
  const [rev] = await rows(db, "select catalog_revision, pricing_revision from v_revisions");
  const items = (await rows(db, "select * from catalog_item order by public_code")).map((r) => {
    const base = {
      id: s(r.id),
      publicCode: s(r.public_code),
      canonicalName: s(r.canonical_name),
      status: r.status ?? null,
      saleUnit: r.sale_unit ?? null,
      measurementSpec: r.measurement_spec ?? null,
      decorationPolicy: r.decoration_policy,
      descriptionInternal: r.description_internal ?? null,
      mergedIntoId: r.merged_into_id ?? null
    };
    return r.kind === "SERVICE" ? {
      ...base,
      kind: "SERVICE",
      customerSuppliedItem: r.customer_supplied_item
    } : { ...base, kind: "PRODUCT", customerSuppliedItem: "NOT_APPLICABLE" };
  });
  const optionDefinitions = (await rows(db, "select * from option_definition order by key")).map(
    (r) => ({
      id: s(r.id),
      key: s(r.key),
      label: s(r.label),
      scope: r.scope,
      valueKind: r.value_kind,
      unit: r.unit ?? null
    })
  );
  const optionValues = (await rows(db, "select * from option_value order by option_definition_id, sort, code")).map((r) => ({
    id: s(r.id),
    optionDefinitionId: s(r.option_definition_id),
    code: s(r.code),
    label: s(r.label),
    spec: r.spec ?? null,
    sort: n(r.sort),
    isActive: Boolean(r.is_active)
  }));
  const itemOptions = (await rows(db, "select * from item_option order by item_id, sort")).map((r) => ({
    itemId: s(r.item_id),
    optionDefinitionId: s(r.option_definition_id),
    isRequired: Boolean(r.is_required),
    selectionMode: r.selection_mode,
    isDistributable: Boolean(r.is_distributable),
    sort: n(r.sort),
    defaultValueId: r.default_value_id ?? null
  }));
  const itemOptionValues = (await rows(db, "select * from item_option_value order by item_id, option_definition_id, sort")).map((r) => ({
    itemId: s(r.item_id),
    optionDefinitionId: s(r.option_definition_id),
    optionValueId: s(r.option_value_id),
    sort: n(r.sort),
    isActive: Boolean(r.is_active)
  }));
  const decorationMethods = (await rows(db, "select * from decoration_method order by key")).map((r) => ({
    id: s(r.id),
    key: s(r.key),
    name: s(r.name),
    isActive: Boolean(r.is_active)
  }));
  const decorationCapabilities = (await rows(db, "select * from decoration_capability order by item_id, method_id")).map((r) => ({
    itemId: s(r.item_id),
    methodId: s(r.method_id),
    constraints: r.constraints ?? null,
    note: r.note ?? null
  }));
  const compositionLines = (await rows(db, "select * from composition_line order by parent_item_id, sort")).map((r) => ({
    id: s(r.id),
    parentItemId: s(r.parent_item_id),
    childItemId: s(r.child_item_id),
    quantity: n(r.quantity),
    role: r.role,
    sort: n(r.sort),
    note: r.note ?? null
  }));
  const markets = (await rows(db, "select * from market order by code")).map((r) => ({
    id: s(r.id),
    code: r.code,
    name: s(r.name),
    defaultCurrency: r.default_currency
  }));
  const priceBooks = (await rows(db, "select * from price_book order by code")).map(
    (r) => r.mode === "DERIVED" ? {
      id: s(r.id),
      code: s(r.code),
      marketId: s(r.market_id),
      currency: r.currency,
      mode: "DERIVED",
      sourcePriceBookId: s(r.source_price_book_id),
      defaultFactor: canonicalDecimal(r.default_factor)
    } : {
      id: s(r.id),
      code: s(r.code),
      marketId: s(r.market_id),
      currency: r.currency,
      mode: "MASTER",
      sourcePriceBookId: null,
      defaultFactor: null
    }
  );
  const itemMarketPolicies = (await rows(db, "select * from item_market_policy order by item_id, market_id")).map((r) => ({
    itemId: s(r.item_id),
    marketId: s(r.market_id),
    pricingMode: r.pricing_mode,
    factorOverride: decOrNull(r.factor_override),
    isAvailable: Boolean(r.is_available)
  }));
  const pricingParameters = (await rows(db, "select * from pricing_parameter order by key, valid_from")).map((r) => ({
    id: s(r.id),
    key: s(r.key),
    value: canonicalDecimal(r.value),
    validFrom: iso(r.valid_from),
    validTo: isoOrNull(r.valid_to)
  }));
  const conditions = await rows(db, "select * from price_condition order by id");
  const condFor = (field, id) => conditions.filter((c) => c[field] === id).map(mapCondition);
  const breaks = await rows(db, "select * from price_break order by price_definition_id, quantity");
  const priceDefinitions = (await rows(
    db,
    "select * from price_definition where status in ('AUTHORIZED', 'SUPERSEDED') order by item_id, id"
  )).map((r) => toDefinition(r, conditions, breaks));
  const assignments = await rows(db, "select * from price_rule_assignment order by item_id");
  const priceRules = (await rows(
    db,
    "select * from price_rule where status in ('AUTHORIZED', 'SUPERSEDED') order by code, version"
  )).map((r) => ({
    id: s(r.id),
    priceBookId: s(r.price_book_id),
    code: s(r.code),
    label: s(r.label),
    kind: r.kind,
    amount: decOrNull(r.amount),
    exclusivityKey: r.exclusivity_key ?? null,
    status: r.status,
    validFrom: iso(r.valid_from),
    validTo: isoOrNull(r.valid_to),
    version: n(r.version),
    supersedesId: r.supersedes_id ?? null,
    authorizedBy: r.authorized_by ?? null,
    authorizedAt: isoOrNull(r.authorized_at),
    conditions: condFor("price_rule_id", s(r.id)),
    itemIds: assignments.filter((a) => a.price_rule_id === r.id).map((a) => s(a.item_id))
  }));
  return {
    revisions: { catalog: n(rev?.catalog_revision ?? 0), pricing: n(rev?.pricing_revision ?? 0) },
    items,
    optionDefinitions,
    optionValues,
    itemOptions,
    itemOptionValues,
    decorationMethods,
    decorationCapabilities,
    compositionLines,
    markets,
    priceBooks,
    itemMarketPolicies,
    pricingParameters,
    priceDefinitions,
    priceRules
  };
}

// product-engine/src/db/client.ts
import { Pool, types } from "pg";
types.setTypeParser(types.builtins.NUMERIC, (v) => v);
types.setTypeParser(types.builtins.INT8, (v) => v);

// product-engine/src/db/crm-api-deps.ts
async function loadPresentations(db) {
  const res = await db.query("select * from presentation order by item_id, locale, id");
  return res.rows.map((r) => ({
    id: r.id,
    itemId: r.item_id,
    locale: r.locale,
    occasion: r.occasion ?? null,
    displayName: r.display_name,
    shortDescription: r.short_description ?? null,
    aliases: r.aliases ?? [],
    seoKeywords: r.seo_keywords ?? [],
    isDefault: r.is_default,
    status: r.status
  }));
}
export {
  authorize,
  errorResponse,
  getItem,
  jsonResponse,
  listItems,
  loadCatalogSnapshot,
  loadPresentations,
  resolve
};
