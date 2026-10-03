# ADR-0011 — Formato del código público `DTG-00001`

**Estado:** ACEPTADO (STEP 04; cierra P1-04 de STEP 03)

## Decisión

- Identidad interna: UUID (`catalog_item.id`), inmutable.
- Identificador humano: `public_code = 'DTG-' + secuencia de al menos 5 dígitos` (`DTG-00001`, `DTG-00002`, …), asignado por secuencia de base de datos, **inmutable y nunca reutilizado**.
- No codifica categoría, mercado, producto, departamento ni método.
- Futuros identificadores (SKU de proveedor, SKU de variante) vivirán en columnas/tablas propias y nunca reutilizarán el prefijo `DTG-`.
- Validación: `^DTG-[0-9]{5,}$` en base de datos y en dominio.
