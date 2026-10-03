# Pricing

`resolvePrice(request, snapshot, asOf) → PriceResult` en `src/pricing/resolve.ts`. Función pura: mismos datos + mismo `asOf` ⇒ mismo resultado. Nunca inventa importes.

## Precedencia

1. **Validar** la configuración → `INVALID` con errores tipados.
2. **Política del item en el mercado** (`item_market_policy` o `INHERIT`):
   - `QUOTE_ONLY` → `QUOTE_ONLY / MARKET_POLICY_QUOTE_ONLY`.
   - USA / `MANUAL` → resolver en el price book del mercado.
   - `DERIVED` (default en México) → resolver en USD y convertir: `total_USD × factor × FX(asOf)`, redondeo half-up a 2 decimales. Factor = override del item o default del book (0.70).
   - `MANUAL` estricto: sin precio manual que cubra la configuración → `QUOTE_ONLY / MANUAL_MX_PRICE_MISSING` (no cae a derivación).
3. **Reglas** (antes que la base, para reportar conflictos y ajustes conocidos): se evalúan **por fila de distribución**. Mismo `exclusivityKey` con importes distintos → `AMBIGUOUS / RULE_CONFLICT`. `REQUIRE_QUOTE` → `QUOTE_ONLY`.
4. **Base (`ITEM`)**: definiciones `AUTHORIZED` vigentes cuyas condiciones se cumplen con las selecciones comunes; gana la más específica; empate → `AMBIGUOUS`. Se evalúa con la **cantidad total**.
5. **Decoraciones**: una definición `DECORATION` por método elegido; sin precio → `QUOTE_ONLY`.
6. **Componentes**: `INCLUDED` se listan sin importe; `OPTIONAL` se resuelven con `resolvePrice(hijo, mercado)` — **política propia de cada item** (ADR-0010).
7. **Total** en la moneda del mercado.

## Modelos

| Modelo                  | Cálculo                                                 | Fuera de rango                              |
| ----------------------- | ------------------------------------------------------- | ------------------------------------------- |
| `FIXED`                 | importe total, `cantidad ≤ max_quantity`                | `FIXED_PRICE_QUANTITY_NOT_AUTHORIZED`       |
| `PER_UNIT`              | importe × cantidad                                      | `BELOW_MIN_QUANTITY` / `ABOVE_MAX_QUANTITY` |
| `EXACT_QUANTITY_MATRIX` | break con cantidad exacta                               | `QUANTITY_NOT_IN_MATRIX` (sin interpolar)   |
| `TIERED`                | mayor break ≤ cantidad                                  | `BELOW_MIN_QUANTITY`                        |
| `MEASURED`              | tarifa × área/largo (in→ft) × cantidad, mínimo opcional | `MEASUREMENT_REQUIRED` (INVALID)            |

## Resultado

- `RESOLVED`: `total: Money`, `breakdown[]` (`BASE`, `DECORATION`, `RULE`, `COMPONENT_INCLUDED`, `COMPONENT_OPTIONAL`, `MARKET_DERIVATION`), `rulesApplied`, `derivation` (fuente USD, factor y su origen, FX y su id, redondeo, total derivado), `components[]` con el resultado completo de cada hijo.
- `QUOTE_ONLY`: `reasonCode`, `detail`, `knownLines` y `knownAdjustments` (informativos, **no se suman**).
- `INVALID`: `errors[]`. `AMBIGUOUS`: defecto de datos del catálogo, con ids en conflicto.
- Siempre: `market`, `currency`, `policy` (book, basis, factor), `effectiveAt`, `revisions`, `explanation[]`.
- Todo importe es `Money` con moneda (ADR-0008). En el wire: `{ "amount": "120.00", "currency": "USD" }`.

## Casos reales verificados (dev slice)

| Caso                                         | Resultado                                         |
| -------------------------------------------- | ------------------------------------------------- |
| Tarjeta Premium · 2 caras · 500              | 120.00 USD                                        |
| Flyer Premium · 2 caras · media carta · 1000 | 400.00 USD                                        |
| Tarjeta Premium 2 caras × 500 en México      | 120 × 0.70 × 16.50 = 1386.00 MXN                  |
| Cantidad 750                                 | `QUOTE_ONLY / QUANTITY_NOT_IN_MATRIX`             |
| Camiseta 9 L + 3 3XL sin base                | `QUOTE_ONLY`, ajuste conocido 3 × 3.00 = 9.00 USD |
| Gorra con talla 3XL                          | `INVALID / OPTION_NOT_ALLOWED`                    |
| Imanes 1 par / 2 pares                       | 65.00 USD / `QUOTE_ONLY` (P1-03)                  |

Casos sin datos reales (México manual, factor por item, reglas en conflicto, tiers, medidas, componentes con políticas distintas) se prueban con **fixtures** en `tests/fixtures/slice.ts`.

## STEP 07 — ciclo de vida y revisiones

Ver `docs/step07/` (PRICING-LIFECYCLE, PRICE-REVISIONING, EFFECTIVE-DATING, PRICE-AUTHORIZATION) y ADR-0017. El resolver acepta AUTHORIZED y SUPERSEDED dentro de su intervalo; los borradores se simulan con `overlayDraft` sin escribir.
