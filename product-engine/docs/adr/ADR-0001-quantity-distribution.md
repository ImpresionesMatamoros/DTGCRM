> Importado de STEP 03 (`STEP_03_OUTPUT/ADR/ADR-001-quantity-distribution.md`). Estado para implementación: **ACEPTADO** en STEP 04. Numeración STEP 03: ADR-001.

# ADR-0001 — Distribución de cantidad dentro de un ConfiguredItem (corrida de tallas)

**Estado:** PROPUESTO (STEP 03) · **Afecta:** `ConfiguredItem` (STEP_02 §10), `ItemOption` (§8), PRICING_MODEL §5

## Problema

STEP 02 modela un `ConfiguredItem` con _un_ conjunto de Option Values y _una_ cantidad. Un pedido real de apparel es “12 camisetas: 9 L + 3 3XL” (HANDOFF S6: factura de camisetas con precio distinto en 2XL). Si el CRM lo parte en dos líneas:

- las escalas por volumen (TIERED) se calcularían sobre 9 y 3 en lugar de 12 → precio incorrecto;
- el recargo 3XL (+3 USD/pieza, BR-026) sólo puede aplicarse a las 3 piezas si el motor sabe cuántas son.
  Sin un concepto explícito, el CRM tendría que reimplementar lógica de pricing (fuga de pricing al CRM).

## Decisión (delta mínimo)

1. `ConfiguredItem` admite `distribution: [{ selections, quantity }]` opcional. `quantity` total = suma de filas.
2. `ItemOption.distributable: boolean` (default false). Sólo opciones distribuibles pueden variar entre filas (hoy: `talla`; futuro: `color` si el dueño lo decide). Las demás selecciones son comunes a toda la línea.
3. Pricing: el precio base se selecciona con la **cantidad total** y las selecciones comunes; las `PriceRule` por unidad se evalúan **por fila** con su cantidad.
4. No se crea entidad maestra nueva: es un value object de runtime + un booleano en `ItemOption`.

## Alternativas descartadas

- Una línea CRM por talla con “agrupador de volumen” en CRM → lógica de precio duplicada en CRM.
- Variant por talla → no resuelve el volumen agregado y empuja a explosión de variantes.

## Verificación contra otros casos

T01/T02 (tarjetas, flyers): sin opciones distribuibles → comportamiento idéntico. T04 (gorra): no tiene `talla` → no aplica. T05/T07/T09/T11: no afectados. Prototipo `evidence/resolver.py` casos S3, S3c, S7: correcto (12 piezas, +9 USD sólo sobre 3 piezas 3XL).
