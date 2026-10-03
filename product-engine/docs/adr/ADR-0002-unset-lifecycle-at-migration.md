> Importado de STEP 03 (`STEP_03_OUTPUT/ADR/ADR-002-unset-lifecycle-at-migration.md`). Estado para implementación: **ACEPTADO** en STEP 04. Numeración STEP 03: ADR-002.

# ADR-0002 — Estado de catálogo “sin asignar” para registros migrados

**Estado:** PROPUESTO · **Afecta:** `CatalogStatus` (STEP_02 §14), BR-036/037

## Problema

197 de 220 ofertas reales no tienen estado comercial confirmado (STEP 01, CURRENT-STATE §8). Los cuatro estados de STEP 02 no permiten importarlas sin inventar:

- `ACTIVE` afirmaría venta actual sin evidencia;
- `CANDIDATE`/`PLANNED` afirmarían lo contrario (Lona, Coroplast son “Core” según el dueño).

## Decisión

- `catalog_status` es **nullable sólo como “no asignado”** (no es un quinto estado de negocio).
- Invariantes: (a) un item con status NULL no puede aparecer en ningún `PublicationProfile`, ni ser configurado/cotizado por el CRM; (b) una vez asignado, el status no puede volver a NULL; (c) items creados fuera de la migración deben nacer con status.
- La causa se registra como `DecisionRecord` abierto (“confirmar estado comercial”) enlazado al item.
- Dashboards calculan “pendientes de estado” como consulta, no como estado almacenado (consistente con STEP 02 §14).

## Alternativas descartadas

- Estado `UNVERIFIED`: contamina el lifecycle con calidad de datos (contradice STEP 02).
- Importar todo como `ACTIVE`/`CANDIDATE`: convierte un unknown en hecho.
- No importar hasta confirmar: pierde identidades y linaje; el dueño revisa mejor sobre datos ya cargados.

## Impacto

No afecta STEP 04 salvo un caso deliberado del slice (Invitación para evento, status NULL) que prueba el bloqueo de publicación. Los estados sembrados en el slice se marcan “provisionales, confirmar con el dueño” (P1-01).
