# ADR-0010 — Resolución de mercado independiente por CatalogItem

**Estado:** ACEPTADO (STEP 04, Boundary Patch 4) · **Precisa:** `PRICING-ENGINE-CONTRACT.md` §4 paso 9

## Contexto

STEP 03 resolvía los componentes opcionales “en el mismo price book” del padre. Con México derivado, eso habría aplicado el factor del padre (p. ej. Yard Sign) al componente (p. ej. Stake), impidiendo factores, overrides o precios manuales distintos por item.

## Decisión

- Cada componente opcional elegido se resuelve con una llamada completa e independiente: `resolve(child, market)`, usando **su propia** `ItemMarketPolicy` (INHERIT/DERIVED/MANUAL/QUOTE_ONLY y factor).
- El resultado del hijo se incorpora al breakdown como línea `COMPONENT_OPTIONAL` que conserva su `basis`, factor y definición.
- La combinación sólo suma importes de la misma moneda (la del mercado); cualquier discrepancia es error interno.
- Si un hijo no resuelve (`QUOTE_ONLY`/`AMBIGUOUS`/`INVALID`), el total del padre no se inventa: el resultado adopta ese estado con la razón `COMPONENT_NOT_PRICED`/propagada.
