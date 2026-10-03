# ADR-0016 — Consola de revisión: borradores, auditoría por campo y actor de aplicación

**Estado:** ACEPTADO (STEP 06)

## Contexto

STEP 05B sólo persistía la resolución al aprobar, y `change_event.changed_by` registraba el rol de la base. La consola necesita guardar decisiones parciales, cambiarlas en masa y saber quién decidió qué, sin romper `approval_sha256` ni el trigger de 0013.

## Decisión

1. **Borrador en la columna existente.** `import_candidate.resolution` guarda el borrador mientras el candidato no está APPROVED. El trigger de 0013 ya lo permitía. Se valida con `RESOLUTION_SCHEMAS[kind].partial()`; aprobar sigue usando `approveCandidate` con el esquema completo. Un APPROVED no se edita: primero se retira la aprobación.
2. **Campos abiertos derivados en TypeScript.** `open_fields` = `unresolvedFields(proposal, draft)`, recalculado al escribir el borrador, para filtrar en SQL sin duplicar reglas.
3. **Auditoría por campo.** `review_event` (append-only) con antes, después, actor, motivo, origen y operación masiva. `review_bulk_operation` (append-only) con los cambios, los IDs, los conteos, la confirmación de sobrescritura, el hash del plan y el origen (`UI_BULK` o `DECISION_GROUP`).
4. **Actor de aplicación en `change_event`.** `record_change()` se redefine en 0014 (misma firma): `changed_by = coalesce(dtg.actor, current_user)` y columna `context`. Cada transacción del Admin fija `dtg.actor` y `dtg.context` con `set_config(..., true)`.
5. **Categoría explícita.** `categoryKey` opcional en la resolución de CATALOG_ITEM y op `ASSIGN_CATEGORY` en el adaptador. Nunca se mapea desde `categoryLegacy`.
6. **Permisos por capacidad.** Cada handler declara una capacidad; el actor local tiene todas menos `price.authorize` (P1-06).

## Consecuencias

- Sin tablas de borradores ni de auditoría genérica adicionales; dos tablas y una vista.
- Las aprobaciones existentes no cambian de hash (`categoryKey` es aditivo y opcional).
- Los grupos de decisión de STEP 05C se aplican por el mismo camino masivo.
