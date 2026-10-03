> Importado de STEP 03 (`STEP_03_OUTPUT/ADR/ADR-006-price-breaks.md`). Estado para implementación: **ACEPTADO** en STEP 04. Numeración STEP 03: ADR-006.

# ADR-0006 — La cantidad sale de `PriceCondition` y vive en `PriceBreak`

**Estado:** PROPUESTO · **Afecta:** PRICING_MODEL §2 (`PriceCondition` filtra “cantidad”)

## Problema

Con la cantidad como condición genérica, la matriz de tarjetas son 40 definiciones cada una con 2 condiciones (caras + cantidad) y los flyers 90 con 4 condiciones. Además “exacta vs umbral” (Yard Sign 1/6/12) quedaría codificado en operadores de condición, que es justo el camino hacia un rules engine genérico.

## Decisión

- `PriceCondition` = sólo selecciones (Option Value, Decoration Method). Semántica: AND entre opciones distintas, IN dentro de la misma opción.
- `PriceBreak` (hijo de `PriceDefinition`): `quantity`, `amount`, `amount_basis` (`TOTAL` | `UNIT`).
- La definición declara `quantity_match`: `EXACT` (EXACT_QUANTITY_MATRIX) o `AT_LEAST` (TIERED). Una misma forma de datos soporta ambas semánticas; decidir Yard Sign exacto vs umbral es cambiar un enum, no el modelo.

## Evidencia

`evidence/extract_output.txt`: las 131 tarifas autorizadas de v1.2 se convierten en **14 definiciones + 131 breaks** sin pérdida (4 de tarjetas, 9 de flyers, 1 de imanes). Prototipo S1, S2, S6 correctos.

## Impacto

No cambia ningún concepto de STEP 02 salvo mover “cantidad” de condición a break. T01, T02, T07, T08 pasan.
