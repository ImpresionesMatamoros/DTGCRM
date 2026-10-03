# ADR-0008 — Money siempre lleva moneda explícita

**Estado:** ACEPTADO (STEP 04, Boundary Patch 2)

## Decisión

- Tipo único `Money = { amount: Decimal; currency: CurrencyCode }` (`CurrencyCode = 'USD' | 'MXN'`), construido sólo con `money()` que valida ambos campos.
- Todo importe de `PriceResult` es `Money`: base, decoraciones, recargos, componentes, `known_adjustments`, importes fuente y derivados, total.
- Operar dos `Money` de monedas distintas lanza error. La conversión USD→MXN es explícita (`convertMoney`) y registra factor y tipo de cambio.
- En el wire JSON, `amount` viaja como **string decimal** (sin pérdida binaria) junto a `currency`.
- En base de datos los importes son `numeric`; la moneda la fija el `price_book` al que pertenecen (no hay columnas de importe sin price book).
- Aritmética decimal con `decimal.js`; nunca `number` para dinero.
