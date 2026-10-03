# Flujo de revisión

**Resolve → Approve → Publish** son pasos separados. En STEP 06 los candidatos REAL llegan como máximo a **APPROVED**.

## 1. Encontrar

`/admin/review` filtra en el servidor por:

- lote y workbook;
- tipo y estado de revisión (o "por revisar" = PENDING/VALID/WARNING);
- severidad de issues;
- estado de catálogo, Product/Service o política de decoración resueltos o sin resolver;
- cualquier campo abierto concreto (`openField=isRequired`, `openField=status`…);
- tiene precio, precio histórico, posible duplicado;
- hoja fuente, texto (nombre, LEGACY_ID, linaje);
- lista explícita de IDs (`?ids=`).

Cada fila muestra el nombre del Excel, el tipo, el estado de revisión, cuántos campos faltan, los campos clave con su origen (**del Excel**, **decidido**, **sin resolver**, **sin asignar**), la celda de origen, los issues y las señales.

## 2. Revisar un candidato

La pantalla de detalle se divide en cuatro bloques:

1. **Source**: workbook, hash, parser y cada celda (hoja, fila, columna, celda, valor original, normalizado, fórmula, caché). Si varios registros generaron el candidato, aparecen todos con su rol (PRIMARY, REFERENCE, VALUE…).
2. **Normalized**: la propuesta del staging tal cual (`null` = desconocido) y los payloads normalizados.
3. **Resolution**: sólo los campos que aplican a ese tipo de candidato.
4. **Domain preview**: el resultado del **Domain Adapter real** (`previewCandidate`) con la resolución guardada. Muestra las operaciones que haría o el error real del adaptador. Si la resolución todavía no cumple el esquema completo, se muestra como INCOMPLETE con los mensajes del esquema.

Debajo: issues con código, severidad, explicación legible, campo afectado y origen; evidencia histórica separada; candidatos del mismo item; y la auditoría.

## 3. Resolver

| Tipo         | Campos que se deciden                                                                                                              |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------- |
| CATALOG_ITEM | tipo, estado de catálogo, política de decoración, artículo del cliente (sólo SERVICE), categoría, unidad de venta, nombre, destino |
| OPTION       | obligatoria, modo de selección, distribuible, definición (existente o nueva), decisión por cada valor del Excel                    |
| DECORATION   | método (asociación) o política (Blank/Personalizada)                                                                               |
| COMPOSITION  | componente, rol (INCLUDED/OPTIONAL), cantidad                                                                                      |
| PRICE        | vigente desde, base del importe, cantidad del precio fijo, destino                                                                 |
| PRESENTATION | idioma, default, nombre, destino                                                                                                   |

Reglas:

- **Nada se preselecciona.** Un campo sin valor muestra "Sin resolver"; elegir es una acción explícita. Para campos que el Excel sí trae, la opción vacía dice "Usar el del Excel (…)".
- `required = null` **nunca** se vuelve `false`.
- La evidencia (categoría del Excel, "Acepta material del cliente: Sí", método sugerido) se muestra aparte y **no** llena ningún campo.
- **Guardar** valida cada campo con su esquema real (`parseDraftResolution`), recalcula los campos abiertos con `unresolvedFields` y escribe un `review_event` por campo cambiado (antes, después, actor y motivo).
- Artículo del cliente usa `NOT_APPLICABLE / ALLOWED / REQUIRED` (no hay Sí/No).
- La categoría no bloquea la aprobación; si se elige, el adaptador la asigna como primaria. Con `LINK_EXISTING` y otra categoría ya asignada, el adaptador reporta `CATEGORY_CONFLICT`.

## 4. Aprobar, rechazar, retirar

- **Aprobar** usa la resolución guardada y pasa por `approveCandidate` (STEP 05B). Exige cubrir todos los campos abiertos. BLOCKED nunca se aprueba. Queda `approval_sha256` ligado al workbook y a la propuesta.
- Un APPROVED **no se edita**: se retira la aprobación (con motivo). Vuelve a VALID/WARNING, conserva el borrador y queda auditado.
- **Rechazar** exige motivo. Es un estado terminal.
- No hay aprobación masiva.

## 5. Publicar

- FIXTURE (DEV/TEST): botón "Publicar FIXTURE" para un candidato APPROVED. Llama a `publishCandidate`.
- REAL: el botón aparece deshabilitado con la razón (`PUBLICATION_ENABLED_FOR = ['FIXTURE']`, P1-09). Además la action lo rechaza (`REAL_PUBLICATION_DISABLED`) y `publishCandidate` lo vuelve a rechazar (`NOT_PUBLISHABLE_IN_THIS_STEP`).

## Operación diaria

```bash
pnpm db:rebuild                                   # ⚠ borra el staging
DTG_SOURCES=… pnpm importer:envelopes && pnpm import:dry-run --report /tmp/dry-run.md
pnpm build && pnpm start                          # o pnpm dev
# http://localhost:3000/admin  → escribe tu nombre en "Actor"
```
