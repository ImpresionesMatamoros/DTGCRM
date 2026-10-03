# ADR-0007 — Persistencia de Variant diferida

**Estado:** ACEPTADO (STEP 04, Boundary Patch 1) · **Modifica:** `LOGICAL-DATA-MODEL.md` §5 (tablas `variant`, `variant_option_value`)

## Contexto

STEP 03 conservó `Variant` como concepto y propuso sus tablas, pero el vertical slice tiene **0 variantes reales** con razón operativa (SKU propio, costo propio, sourcing, disponibilidad o identidad operativa). Todas las diferencias de configuración del slice se expresan con Option Values.

## Decisión

- No se crean `variant` ni `variant_option_value` en STEP 04.
- `Variant` permanece en el modelo conceptual y en `docs/DOMAIN-MODEL.md`.
- El contrato de pricing no acepta `variant_id` todavía (se agregará con la tabla).
- La persistencia se introduce, con ADR propio, cuando aparezca el primer caso real que cumpla al menos uno de los criterios anteriores.

## Consecuencias

- Menos superficie de esquema y de pruebas sin datos que las justifiquen.
- Las condiciones de precio se basan en Option Values, por lo que agregar variantes después no obliga a migrar precios.
