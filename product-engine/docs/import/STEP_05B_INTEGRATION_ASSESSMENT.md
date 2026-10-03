# STEP 05B · Integration assessment

Escrito **antes de cualquier cambio de código**. Base: rama `step05b/import-pipeline` creada desde `5c37b83` (HEAD aprobado de STEP 04, `main`, 13 commits, árbol limpio).

## 1. Verificaciones iniciales

| Verificación                                    | Resultado                                                                                                                                            |
| ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| Historial STEP 04                               | 13 commits, `3750b1e … 5c37b83`, sin reescrituras                                                                                                    |
| HEAD                                            | `5c37b83 docs: add STEP 04 foundation report`                                                                                                        |
| `pnpm verify` (lint, typecheck, unit, build)    | OK · 79 pruebas unitarias                                                                                                                            |
| `pnpm seed:check`                               | OK · seeds sin drift                                                                                                                                 |
| `pnpm db:rebuild`                               | OK · 11 migraciones, 2 seeds, 24 pruebas de integración                                                                                              |
| STEP 05A `python -m unittest discover -s tests` | OK · 27 pruebas (Python 3.11.15, openpyxl 3.1.5)                                                                                                     |
| Fuentes Excel (5)                               | SHA-256 idénticos a `summary.json` de STEP 05A (v1.2 `41b4fc07…`, v1.1 `9cf5dc7b…`, costeo `9228c5f8…`, comprensión `fdfc0a91…`, gorras `88eb9be1…`) |

Documentos leídos: STEP 04 (`STEP_04_FOUNDATION_REPORT`, `DOMAIN-MODEL`, `DATABASE`, `PRICING`, `DECISIONS`, ADR-0001…0013, `src/domain/*`, migraciones 0001–0011) y STEP 05A (`README`, `IMPORT-ARCHITECTURE`, `IMPORT-MAPPING`, `RAW-IMPORT-CONTRACT`, `STAGING-CONTRACT`, `PROVENANCE-SPEC`, `VALIDATION-RULES`, `IMPORT-ERROR-TAXONOMY`, `DOMAIN-MAPPING-QUESTIONS`, `DUPLICATE-DETECTION`, `STEP_05B-INTEGRATION-PLAN`, código `parser/*`, `tests/test_parser.py`).

## 2. Qué se reutiliza sin cambios

| Pieza STEP 05A                                                                                          | Uso en 05B                                                                                 |
| ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `parser/` completo (reader, adapters, normalizers, validation, mapper, pipeline, report), versión 0.1.0 | Copiado tal cual a `tools/excel-importer/parser/`; misma salida byte a byte                |
| `tests/test_parser.py` (27)                                                                             | Copiado tal cual; se ejecuta generando antes la evidencia en el directorio del tool        |
| Taxonomía de issues (17 códigos) y severidades                                                          | Se persiste literal en `import_issue`                                                      |
| Detector de duplicados (EXACT / PROBABLE / RELATIONSHIP_NOT_DUPLICATE)                                  | Se persiste como revisión A/B + señales; nunca fusiona                                     |
| IDs deterministas (`stable_id`, 24 hex)                                                                 | Claves de staging (`record_key`, `candidate_key`, `issue_key`), nunca identidad de dominio |
| Separación de 23 precios históricos                                                                     | Se respetan; nunca entran a candidatos de precio                                           |
| Procedencia por celda (`SourceCell`)                                                                    | Se conserva completa en `import_record.source_cells`                                       |

STEP 04 se reutiliza sin cambios: dominio (`src/domain`), resolvedor de precios, contrato de API, migraciones 0001–0011 y seeds. Nada del motor de precios se rediseña.

## 3. Qué necesita adaptador

| Diferencia                                                                                                                             | Adaptador                                                                                                                                                             |
| -------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| La salida del parser es un JSON por workbook de 22–71 MB con `profile`, fuentes duplicadas en candidatos e issues                      | Exportador Python **nuevo** (`tools/excel-importer/interchange/`) que emite un `ImportEnvelope` versionado sin duplicar celdas (los candidatos referencian registros) |
| Contrato conceptual `parser/contracts.ts` (no validado en runtime)                                                                     | Esquema Zod `src/import/contract.ts` + JSON Schema generado y verificado                                                                                              |
| No hay candidatos de presentación (PRESENTACIONES / PRESENTACIÓN_OFERTA sólo son RAW)                                                  | El exportador agrega candidatos `presentation` por enlace, con joins explícitos y la misma regla de IDs                                                               |
| 131 candidatos de precio son **observaciones**; el dominio necesita definiciones                                                       | Agrupación en staging: 14 candidatos `PRICE` (13 matrices exactas + 1 FIXED) que conservan las 131 observaciones y sus celdas                                         |
| Hipótesis snake_case (`catalog_status_hypothesis`, `required: null`, `item_type_hypothesis`)                                           | Adaptador de dominio explícito con resolución humana; `null` ⇒ campo sin resolver, nunca default                                                                      |
| Métodos Excel (`DTF textil`, `Bordado`, `UV DTF`, `Impresión`…) vs `decoration_method` (`DTF`, `EMBROIDERY`, `SCREEN_PRINTING`, `HTV`) | Sugerencia versionada; publicar exige resolución explícita (asociación ≠ decoración elegible)                                                                         |
| Imán `FIXED` sin cantidad; dominio exige `max_quantity`                                                                                | Campo sin resolver `maxQuantity` (P1-03); no se inventa 1                                                                                                             |
| Identidad legacy (`MIG1-O-009`) vs UUID + `DTG-xxxxx`                                                                                  | Índice de linaje = `source_reference` `LEGACY_ID`; UUID y código público sólo al publicar                                                                             |
| `tests/test_parser.py` lee `ROOT/evidence` y `ROOT/fixtures`                                                                           | Script `importer:test` genera primero la evidencia en `tools/excel-importer/` (ignorada por Git); no se editan las pruebas                                            |

## 4. Incompatibilidades detectadas

| #   | Incompatibilidad                                                                                                     | Severidad | Tratamiento                                                                                               |
| --- | -------------------------------------------------------------------------------------------------------------------- | --------- | --------------------------------------------------------------------------------------------------------- |
| I1  | Q-01 (enum de estado) — STEP 04 ya fijó `CANDIDATE/PLANNED/ACTIVE/RETIRED`, que coincide con la hipótesis del parser | Cerrada   | Sin acción; se documenta                                                                                  |
| I2  | Q-02 `Obligatoria` vacía: el mapping de STEP 03 proponía `false`                                                     | P1        | Se conserva `null` ⇒ `isRequired` sin resolver; el adaptador rechaza publicar                             |
| I3  | Las 10 fixtures reales de 05A coinciden con items del dev slice ya sembrados                                         | Diseño    | Publicación con modo `LINK_EXISTING` (conciliación contra el seed) y modo `CREATE` sólo con fixtures TEST |
| I4  | Los Excel no están en el repositorio; las pruebas reales de 05A los necesitan                                        | P1        | `DTG_SOURCES` explícito; CI ejecuta sólo las pruebas sin fuente; se documenta                             |
| I5  | Evidencia completa (135 MB) no versionable                                                                           | Diseño    | Se versionan sólo envelopes de fixtures; la evidencia se regenera de forma determinista                   |
| I6  | `decoration_policy` y `is_required` tienen default en BD (`NONE`, `false`)                                           | Diseño    | El adaptador nunca depende de esos defaults: exige valor explícito                                        |
| I7  | Market/moneda: no hay precios MXN reales; un precio MXN explícito no tiene destino automático                        | P1        | Queda como evidencia bloqueada (`MX_PRICE_EVIDENCE_ONLY`); no se recalcula ni corrige                     |

No se detectó ningún **P0**: los contratos de STEP 04 pueden representar todo lo que 05B debe persistir, y la salida de 05A es determinista y verificable.

## 5. Qué NO se modificará

- Parser STEP 05A (lógica, versión 0.1.0, pruebas): sin cambios funcionales. La presentación se agrega en un módulo nuevo del tool, no dentro de `mapper.py`.
- Migraciones 0001–0011 y seeds generados; cualquier estructura nueva va en `0012+`.
- Dominio y resolvedor de precios (`src/domain`, `src/pricing`), contrato de API v1.
- Los cinco Excel fuente (sólo lectura, hash verificado antes y después).
- CRM, Supabase remoto, despliegue: fuera de alcance.
- No se crean `variant`, `bundle`, `supplier`, `brand`, inventario, BOM, work orders, ni tablas `staging_product/service/price/…`.

## 6. Plan de integración

`Excel → parser 05A → interchange (ImportEnvelope v1) → Zod → staging persistente (import_*) → validación → candidatos revisables → aprobación explícita → adaptador de dominio → publicación controlada (sólo FIXTURE en 05B)`.

Tablas nuevas previstas: `import_batch`, `import_record`, `import_candidate`, `import_issue`, `import_candidate_source` y `import_candidate_link` (linaje staging → dominio). El historial de revisión se audita con el `change_event` existente (nuevo scope `IMPORT`).
