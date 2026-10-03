# ImportEnvelope v1 — contrato de intercambio

Frontera entre el importador Python y el bridge TypeScript. Fuente de verdad: `src/import/contract.ts` (Zod). JSON Schema generado: `contracts/import-envelope.v1.schema.json` (`pnpm import:schema`, verificado en CI con `--check`).

## Principios

- JSON serializable, **snake_case** (igual que el contrato de API v1). Los campos del parser 05A conservan su nombre para que cada valor remita a su documentación.
- Sin objetos de PostgreSQL, sin UUID de Product Engine, sin código público, sin bandera de publicación.
- Conserva valor RAW, valor normalizado, fórmula, caché y coordenada de cada celda.
- Los candidatos referencian registros (`record_ids`); las celdas no se repiten. El exportador **prueba** que las celdas del candidato del parser son exactamente la concatenación de las de sus registros; si no, falla.
- Versionado semántico: `contract_version` `1.x.y`. Un cambio incompatible exige `2.0.0`; el bridge rechaza cualquier mayor distinta de 1.

## Secciones

| Sección             | Contenido                                                                                                                                                |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `contract`          | `dtg.import-envelope`                                                                                                                                    |
| `producer`          | versión del exportador, nombre y versión del parser                                                                                                      |
| `import_batch`      | `source_batch_id` (clave del parser), archivo, SHA-256, rol (`PRIMARY_RC`/`COMPARISON`/`SPECIALIZED_EVIDENCE`), `data_class` (`REAL`/`FIXTURE`), conteos |
| `provenance`        | identidad del workbook (hash, título, versión, avisos del lector) y perfil completo (hojas, fórmulas, validaciones) o `null` en fixtures                 |
| `records`           | `RawRecord`: `raw_payload`, `normalized_payload`, `source[]` (celdas), `synthetic`, `issue_ids`                                                          |
| `candidates`        | `catalog_item`, `option`, `decoration`, `composition`, `price` (observación), `presentation`; siempre `PENDING_REVIEW`, `publishable: false`             |
| `historical_prices` | 23 precios históricos con sus condiciones; **nunca** candidatos                                                                                          |
| `duplicate_reviews` | pares A/B con señales y recomendación; nunca fusiones                                                                                                    |
| `issues`            | código, severidad, origen (`PARSER`/`INTERCHANGE`), registro; celdas sólo si no hay registro                                                             |

## Validación (Zod `superRefine`)

Rechaza: campos desconocidos (objetos estrictos), mayor ≠ 1, hash del workbook distinto entre secciones, celdas de otro workbook, registros o candidatos duplicados, referencias a registros o issues inexistentes, candidatos con registros TEST, evidencia histórica como candidato, issues con registro que repiten celdas, conteos inconsistentes, `REAL` que no trae todos los registros del parser, `FIXTURE` sin nombre. `parseImportEnvelope()` nunca lanza: devuelve `{ ok: false, errors: [{ path, message }] }`.

## Generación

```bash
DTG_SOURCES=/ruta/workbooks pnpm importer:envelopes             # REAL → .import/envelopes/
DTG_SOURCES=/ruta/workbooks pnpm importer:envelopes --fixtures  # FIXTURE → tests/fixtures/import/
```

Determinista: mismos bytes + mismas versiones ⇒ mismo envelope (claves ordenadas, sin marcas de tiempo). Los fixtures versionados en Git son subconjuntos reales de v1.2 (`data_class = FIXTURE`) y `real-price-evidence.v1_2.json` (extracto sin celdas de los 131 precios y 23 históricos).
