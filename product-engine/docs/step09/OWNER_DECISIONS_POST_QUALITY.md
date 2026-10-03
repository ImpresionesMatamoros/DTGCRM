# STEP 09 completion — Calidad de datos tras las decisiones del dueño

Generado por `tsx scripts/step09-completion-report.ts post` el 2026-10-02T09:01:03.387Z. Se recomputan las 52 reglas de STEP 08 (sin cambios de reglas) sobre el staging real. Nada de lo que no es del alcance se oculta.

## Antes y después (todo el staging real)

| Medida                       | Antes de las decisiones (fin STEP 09) | Después |
| ---------------------------- | ------------------------------------- | ------- |
| Candidatos en staging        | 407                                   | 391     |
| Candidatos resueltos         | 32                                    | 42      |
| Hallazgos                    | 1212                                  | 1122    |
| Bloqueantes                  | 989                                   | 915     |
| Advertencias                 | 219                                   | 203     |
| Requieren decisión del dueño | 678                                   | 633     |

Los candidatos rechazados (13 de alias/configuración/estilo/legacy de esta pasada, más las decoraciones "Impresión" rechazadas por OD-04) no levantan hallazgos: son "no importar" explícito, con su evidencia conservada.

## Commercial Print: qué bloqueos desaparecieron (16 filas antes bloqueadas)

| Legacy       | Fila                                 | Antes (decisiones abiertas)                  | Después                                           | Estado resultante      |
| ------------ | ------------------------------------ | -------------------------------------------- | ------------------------------------------------- | ---------------------- |
| MIG2-O-037   | Tabloides                            | BLOQUEADO: D-001, D-002                      | PUBLISHED                                         | ACTIVE · QUOTE_ONLY    |
| MIG2-O-038   | Posters                              | BLOQUEADO: D-001, D-002                      | PUBLISHED                                         | ACTIVE · QUOTE_ONLY    |
| MIG2-O-039   | Menús                                | BLOQUEADO: D-001, D-002, D-004, D-005        | PUBLISHED                                         | ACTIVE · QUOTE_ONLY    |
| MIG2-O-046   | Tarjetas complementarias             | BLOQUEADO: D-001, D-002                      | RESUELTO (LEGACY_INVALID)                         | —                      |
| MIG2-O-047   | Seating card / place card            | BLOQUEADO: D-001, D-002                      | PUBLISHED                                         | CANDIDATE · QUOTE_ONLY |
| MIG2-O-048   | Thank-you card                       | BLOQUEADO: D-001, D-002                      | PUBLISHED                                         | CANDIDATE · QUOTE_ONLY |
| MIGF-O-008   | Invitación sencilla                  | BLOQUEADO: D-001, D-002, D-018               | PUBLISHED                                         | ACTIVE · QUOTE_ONLY    |
| MIGF-O-009   | Invitación premium                   | BLOQUEADO: D-001, D-002, D-018               | PUBLISHED                                         | ACTIVE · QUOTE_ONLY    |
| MIGF-O-010   | Invitación para evento               | BLOQUEADO: D-001, D-002, D-018               | RESUELTO (ALIAS → MIGF-O-008, MIGF-O-009)         | —                      |
| MIGF-O-011   | Invitación con sobre                 | BLOQUEADO: D-001, D-002, D-018               | RESUELTO (CONFIGURATION → MIGF-O-008, MIGF-O-009) | —                      |
| MIGF-O-012   | Invitación con sello                 | BLOQUEADO: D-001, D-002, D-018               | RESUELTO (CONFIGURATION → MIGF-O-009)             | —                      |
| MIGF-O-013   | Invitación con acrílico              | BLOQUEADO: D-001, D-002, D-004, D-005, D-018 | RESUELTO (CONFIGURATION → MIGF-O-009)             | —                      |
| MIGF-O-014   | Invitación especial                  | BLOQUEADO: D-001, D-002, D-018               | RESUELTO (LEGACY_INVALID)                         | —                      |
| OWN-MT-O-046 | Periódico personalizado para eventos | BLOQUEADO: D-001, D-002, D-003               | PUBLISHED                                         | ACTIVE · QUOTE_ONLY    |
| OWN-O-007    | Invitación formal                    | BLOQUEADO: D-001, D-002, D-018               | RESUELTO (STYLE → MIGF-O-008, MIGF-O-009)         | —                      |
| OWN-O-008    | Invitación casual                    | BLOQUEADO: D-001, D-002, D-018               | RESUELTO (STYLE → MIGF-O-008, MIGF-O-009)         | —                      |

Totales de la compuerta: antes 5 publicables / 16 bloqueados → ahora **13 pasan como producto (13 publicados) · 8 resueltos como no-producto · 0 bloqueados**.

| Decisión                | Antes                                  | Ahora                                                                       |
| ----------------------- | -------------------------------------- | --------------------------------------------------------------------------- |
| D-001 estado            | 16 filas abiertas                      | 0 (ACTIVE ×6, CANDIDATE ×2, 8 filas no-producto cubiertas por D-018/legacy) |
| D-002 unidad            | 16 filas abiertas                      | 0                                                                           |
| D-003 producto/servicio | 1 (Periódico)                          | 0                                                                           |
| D-004 / D-005           | 2 filas c/u (Menús, Inv. con acrílico) | 0                                                                           |
| D-018 invitaciones      | 9 filas                                | 0                                                                           |

Decisiones que siguen abiertas sobre items del alcance: ninguna. (D-009 navegación del imán y D-022 México no bloquean; ver el reporte final.)

## Hallazgos que siguen vigentes en los items migrados (no se esconden)

Los items nuevos están ACTIVE + QUOTE_ONLY sin precio autorizado (válido, decisión 107) y sin opciones de tamaño/caras de Menús (el workbook no trae esos valores y no se inventan). Esto se refleja como readiness de precios QUOTE_ONLY y no como bloqueo. Los 915 bloqueantes restantes pertenecen a otras categorías (Apparel, Displays, etc.) fuera del permiso.

## Verificaciones de esta pasada

| Verificación                                                                                      | Resultado                                                                                                                               |
| ------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Filas no-producto con CatalogItem creado por esta pasada                                          | 0                                                                                                                                       |
| Filas no-producto con CatalogItem preexistente (dev slice; sin estado ⇒ en ningún perfil público) | 1 — DTG-00016 (MIGF-O-010, sin estado, 0 perfiles, 0 publicaciones de migración)                                                        |
| Disposiciones registradas (candidate_disposition)                                                 | 8                                                                                                                                       |
| Cada disposición apunta a la respuesta vigente de su decisión                                     | OK                                                                                                                                      |
| Evidencia conservada (candidatos rechazados con celdas de origen)                                 | MIG2-O-046:1c/26 MIGF-O-010:4c/128 MIGF-O-011:1c/26 MIGF-O-012:1c/26 MIGF-O-013:3c/132 MIGF-O-014:1c/26 OWN-O-007:1c/26 OWN-O-008:1c/26 |
| Items CANDIDATE migrados / visibles en algún perfil público                                       | 2 / 0                                                                                                                                   |
| Casos de precio por el Price Engine                                                               | 13/13 OK                                                                                                                                |
| Procedencia de candidatos publicados                                                              | 34/34                                                                                                                                   |
| Enlaces duplicados / ids legacy duplicados / códigos duplicados                                   | 0 / 0 / 0                                                                                                                               |
| Publicados fuera del alcance / fuera del permiso                                                  | 0 / 0                                                                                                                                   |
