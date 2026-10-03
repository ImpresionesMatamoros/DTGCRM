# Cambios masivos

## Uso

1. En `/admin/review`, filtra (por ejemplo `kind=CATALOG_ITEM`, `catalogStatus=unresolved`).
2. Selecciona filas, la página entera o **todos los que cumplen el filtro** (hasta 2000).
3. Elige campo y valor. Si la selección mezcla tipos, eliges qué tipo cambiar; los demás se omiten.
4. **Vista previa** (calculada en el servidor):

   ```
   47 seleccionados · 43 candidatos cambiarán
   43 estaban sin resolver · 0 ya tenían ese valor · 4 tenían otro valor
   Se omiten: 2 bloqueados, 1 aprobado
   Valores distintos que NO se sobrescriben sin confirmar: …
   [ ] Sí, sobrescribir esos 4 valores distintos
   [Cancelar] [Aplicar a 43]
   ```

5. **Aplicar**. Queda una fila en `review_bulk_operation` y un `review_event` por campo escrito.

## Campos masivos

Sólo campos escalares y compatibles, definidos en `FIELD_DEFS` con `bulk: true`:

| Tipo         | Campos                                                                        |
| ------------ | ----------------------------------------------------------------------------- |
| CATALOG_ITEM | tipo, estado, política de decoración, artículo del cliente, categoría, unidad |
| OPTION       | obligatoria, modo de selección, distribuible                                  |
| DECORATION   | método                                                                        |
| PRICE        | vigente desde, base del importe                                               |
| PRESENTATION | idioma, default                                                               |

No son masivos: nombre, destino, definición y valores de opción (dependen de cada candidato).

## Garantías

- **Explícito**: nada se aplica sin vista previa.
- **Conteos**: cuántos cambian, cuántos estaban sin resolver, cuántos ya tenían el valor, cuántos tenían otro y cuántos se omiten, con el motivo.
- **Valores distintos**: tanto un borrador previo como un valor explícito del Excel cuentan como "otro valor". **Nunca** se sobrescriben sin confirmar la casilla.
- **Omitidos**: BLOCKED (no se puede aprobar), APPROVED (retirar primero), PUBLISHED/REJECTED, PENDING, otro tipo, campo no aplicable (por ejemplo, artículo del cliente en un PRODUCT).
- **Sin vista previa vieja**: al aplicar, el servidor bloquea los candidatos, recalcula el plan y compara `planSha256`. Si alguien cambió algo entre medio, responde `STALE_PREVIEW` y no escribe nada.
- **Auditable**: actor, cambios, IDs, conteos, confirmación, motivo y origen. `change_event` también registra cada fila con `context = admin:review.bulk_apply`.
- **Sin deshacer mágico**: se corrige con otra decisión (queda también en el historial).
- Límite de 2000 candidatos por operación.

## Enganche para STEP 05C (grupos de decisión)

El planificador no asume revisión candidato por candidato. Un grupo de decisión (por ejemplo, `D-001: aplicar recargo 2XL/3XL a …`) se aplica con:

```ts
bulkApplyHandler(tx, actor, {
  candidateIds: [...ids del grupo],
  kind: 'CATALOG_ITEM',
  changes: { decorationPolicy: 'OPTIONAL' },
  planSha256,           // de bulkPreviewHandler con los mismos datos
  overwrite: false,
  decisionGroup: 'D-001',
});
```

La operación queda con `origin = DECISION_GROUP` y `origin_ref = 'D-001'`. En la UI, `/admin/review?ids=…` muestra exactamente los candidatos de un grupo, listos para el mismo flujo. No se copian clasificaciones automáticamente: siempre hay vista previa y confirmación.

## STEP 08 — extensiones

- **Modo estricto** (`strict`): una selección con candidatos de un tipo que no tiene el campo se rechaza entera (`INCOMPATIBLE_SELECTION`); nunca se ofrece `Option.required` sobre artículos.
- La vista previa mantiene UNRESOLVED/SAME/DIFFERENT y añade un resumen (`seleccionados`, `cambiarían`, `ya iguales`, `con otro valor`, `no aplica`, `bloqueados`, `requiere confirmar sobrescritura`).
- **Remediación por regla** (`/admin/data-quality/issues?rule=…`): los candidatos son los hallazgos `BULK_RESOLVABLE` vigentes de esa regla, el campo es el de la regla; siempre vista previa → aplicar; vista previa obsoleta rechazada.
- **Grupo de decisión**: `DECISION_GROUP` exige una respuesta vigente registrada (`DECISION_NOT_ANSWERED` si no) y guarda `decision_answer_id` además de origen y `D-xxx`.
- **Categorías**: el mapeo origen → categoría usa el mismo planificador y deja un registro en `category_mapping`.
