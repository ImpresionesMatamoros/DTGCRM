# ADR-0020 — Disposición de candidatos y canonicalización (cierre de STEP 09)

**Estado:** ACEPTADO (STEP 09, pasada "Owner Decisions")

## Contexto

La `OWNER_DECISION_SPEC_v1.0` aclara que varias de las 16 filas bloqueadas de Commercial Print **no son productos**: son etiqueta genérica (alias), configuración o estilo de un producto canónico, o un nombre legacy nunca válido. Rechazar el candidato conserva la evidencia pero pierde el porqué y el destino. "21 filas" no significa "21 productos".

## Decisión

1. **Una tabla pequeña, append-only** (migración 0018 `candidate_disposition`): por fila fuente, `ALIAS | CONFIGURATION | STYLE | LEGACY_INVALID`, los ids legacy canónicos a los que pertenece (vacío sólo para LEGACY_INVALID, lo exige un CHECK), el detalle en palabras del dueño y la **respuesta de decisión registrada** (`decision_answer_id`) que la respalda. Sin UPDATE/DELETE, auditada, `supersedes_id` para revisar. No es MDM: no fusiona, no crea ni borra CatalogItems.
2. **La evidencia no se borra**: todos los candidatos de la fila se **rechazan** con razón (mecanismo no destructivo ya existente); sus registros y celdas del Excel siguen trazables.
3. **Veredicto `RESOLVED`** en la compuerta de migración: la fila está resuelta (con disposición), no está bloqueada ni es publicable. Una fila ya PUBLISHED nunca se degrada. Las filas sin disposición siguen BLOQUEADAS: la ausencia no resuelve nada.
4. **Sin cadenas**: una disposición no puede apuntar a otra fila no-producto, ni a sí misma ni fuera del alcance.
5. **CANDIDATE** se migra como registro interno con estado `CANDIDATE`. Todos los perfiles de publicación permiten sólo `ACTIVE` (`v_publication_membership`), por lo que nunca es público; la prueba lo verifica sobre el estado y sobre los perfiles sembrados.
6. **Semántica de tramo alcanzado** (invitaciones 12…300; menús 1/6): el modelo `TIERED` del motor de precios ya es "el mayor umbral ≤ cantidad", se queda en el último tramo por encima y cotiza por debajo del primero. **No se cambió el motor**; se agregaron pruebas deterministas con fixtures sintéticos (24→12, 25→25, 48→25, 50→50, 301→300, 11→QUOTE_ONLY). No se guarda ningún precio: los items son `ACTIVE + QUOTE_ONLY` hasta que Martín autorice precios.
7. **Categoría = taxonomía de implementación**: los ocho productos canónicos van a `impresos_papel` (existente); no se amplió la taxonomía.
8. **Heurística de sugerencia de precio** (2×costo y referencia de mercado, promediadas; la referencia puede ser propuesta por IA con evidencia vigente) es **consultiva**: no hay código que autorice con ella; el único autorizador del precio maestro sigue siendo Martín (`price.authorize`).

## Bundles (capacidad futura, no implementada)

Auditoría del modelo: `composition_line` (INCLUDED/OPTIONAL) ya relaciona un CatalogItem con otros; `catalog_item_kind` es `PRODUCT | SERVICE`; el staging bloquea `BUNDLE` (`BUNDLE_NOT_SUPPORTED`) en vez de degradarlo. Nada de esta pasada lo cierra: una configuración como "con sello" es una fila de disposición, no un componente; un bundle futuro podrá ser un item con composición sin cambiar identidades ya publicadas. No se agregaron tablas ni UI de bundles.

## Consecuencias

Una migración (0018), un módulo de BD (`src/db/migration/disposition.ts`), un veredicto en la compuerta pura y su visualización en la página de migración. Las configuraciones de Premium (sello, acrílico, sobre) quedan registradas como disposición hacia el producto canónico; no se materializan como opciones de precio hasta que existan sus recargos autorizados.
