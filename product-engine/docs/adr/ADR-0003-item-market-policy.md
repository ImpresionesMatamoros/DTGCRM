> Importado de STEP 03 (`STEP_03_OUTPUT/ADR/ADR-003-item-market-policy.md`). Estado para implementación: **ACEPTADO** en STEP 04. Numeración STEP 03: ADR-003.

# ADR-0003 — Política de precio por Item × Market y cobertura del precio manual México

**Estado:** PROPUESTO · **Afecta:** `Market`, `PriceBook` (PRICING_MODEL §4), BR-028…032

## Problema

El dueño definió `MXN = USD × factor × FX`, con factor sobrescribible por Product y precio México manual que prevalece (BR-029/031). STEP 02 no define:

1. dónde vive el factor por Product;
2. qué pasa si hay precio manual MX para **algunas** configuraciones de un Product (p. ej. una celda de la matriz de tarjetas) y no para otras.

Si el motor mezcla silenciosamente celdas manuales y derivadas, una lista MX puede combinar dos lógicas comerciales sin que nadie lo decida.

## Decisión

Concepto lógico `ItemMarketPolicy` (item × market), valor opcional:

- `pricing_mode`: `INHERIT` (default del PriceBook) · `DERIVED` · `MANUAL` · `QUOTE_ONLY`;
- `factor_override` (sólo con DERIVED/INHERIT);
- `available` (bool, default true).

Reglas:

- **MANUAL es estricto:** si no existe definición manual MX que cubra la configuración → `QUOTE_ONLY` (razón `MANUAL_MX_PRICE_MISSING`), **sin** caer a derivación.
- Si el dueño quiere cobertura mixta, se agrega el valor `MANUAL_WITH_DERIVED_FALLBACK` al enum (cambio de datos/enum, no de estructura). **OPEN (P2-03).**
- En DERIVED las reglas (recargos) se aplican en la moneda fuente (USD) y el total se convierte; los importes derivados **no se almacenan** (BR-032).
- En MANUAL sólo se usan reglas del PriceBook MX; una regla USD sin contraparte MX produce `QUOTE_ONLY` (`RULE_NOT_DEFINED_FOR_MARKET`).

## Verificación

Prototipo S4 (derivado default 120 USD → 1 386.00 MXN), S4b (factor por producto, FIXTURE), S5 (manual, FIXTURE), S5b (manual sin cobertura → QUOTE_ONLY). No afecta T01–T12 en USA.

## Addendum STEP 04

- `ItemMarketPolicy` es **persistente** (tabla `item_market_policy`), no un valor derivable: debe poder almacenar p. ej. `MX · DERIVED · factor_override = 0.50` o `MX · MANUAL`. La ausencia de fila equivale a `INHERIT`.
- La política se resuelve **por CatalogItem**, también para componentes opcionales (ver ADR-0010).
