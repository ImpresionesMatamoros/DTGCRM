> Importado de STEP 03 (`STEP_03_OUTPUT/ADR/ADR-004-decoration-as-priced-selection.md`). Estado para implementación: **ACEPTADO** en STEP 04. Numeración STEP 03: ADR-004.

# ADR-0004 — Decoración como selección con precio propio; blank vs personalizado sin Option

**Estado:** PROPUESTO · **Afecta:** `DecorationSelection`, `PriceDefinition`, BR-012, BR-021

## Problema

El Excel usa una Option `modalidad {Blank, Personalizada}` (OWN-OP-002/004/006/008). STEP 02 dice que el mismo Product se vende sin decoración o con Decoration Selections. Si se migra `modalidad` como Option, existen dos fuentes de verdad (la opción y la presencia de decoraciones) que pueden contradecirse. Además STEP 02 no dice dónde vive el precio de la decoración, aunque el dueño exige breakdown interno “bien + decoración + recargos” (BR-021).

## Decisión

1. **No migrar `modalidad` como Option.** “Blank” = ConfiguredItem sin decoration selections.
2. `CatalogItem.decoration_policy`: `NONE` · `OPTIONAL` · `REQUIRED` (p. ej. el Service de aplicación sobre artículo del cliente es REQUIRED).
3. `PriceDefinition.component`: `ITEM` · `DECORATION`. Las definiciones DECORATION se condicionan por método (y opcionalmente ubicación/tamaño de impresión). Una línea resuelve: 1 ITEM + 1 DECORATION por selección.
4. Si una decoración seleccionada no tiene definición autorizada → la línea completa es `QUOTE_ONLY` (no se omite silenciosamente).

## Verificación

T03 (blank y personalizada sin duplicar Product), T04, T09 (Service con decoración REQUIRED). Prototipo S3 (DTF sin precio → QUOTE_ONLY) y S3c (blank con base FIXTURE → RESOLVED).
