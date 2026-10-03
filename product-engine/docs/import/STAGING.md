# Staging persistente

Migraciones `0012_import_staging.sql` y `0013_import_review.sql`. Staging es **genérico** (candidato + tipo + propuesta JSONB); no existen `staging_product`, `staging_price`, etc.

## Tablas

| Tabla                     | Qué guarda                                                                                                         |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `import_batch`            | Una corrida por workbook: archivo, SHA-256, versiones, rol, `data_class`, linaje, intento, conteos, perfil, estado |
| `import_record`           | Registro del parser: payload RAW y normalizado, celdas; `evidence_class = HISTORICAL_PRICE` para los 23 históricos |
| `import_candidate`        | Hipótesis revisable: `kind`, `lineage_key`, `proposal`, `payload_sha256`, campos sin resolver, bloqueos, revisión  |
| `import_candidate_source` | Candidato → registros con rol (`PRIMARY`, `REFERENCE`, `VALUE`, `CONDITION`, `OBSERVATION`, `ATTRIBUTE`)           |
| `import_issue`            | Issues del parser, del interchange, de staging (revisión de duplicados) y del adaptador                            |
| `import_candidate_link`   | Linaje candidato → entidad de dominio (`CREATED` / `LINKED_EXISTING`) — la tabla adicional justificada             |

Garantías de la base: historia append-only (no se borra nada; registros, fuentes, issues y enlaces son inmutables; la propuesta de un candidato no cambia), identidad de lote congelada, **evidencia histórica no puede alimentar un candidato PRICE**, filas TEST no pueden alimentar candidatos, un enlace sólo se escribe para un candidato `APPROVED`.

## Candidatos

| Kind           | Origen                                                | Propuesta (camelCase)                                                                         |
| -------------- | ----------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `CATALOG_ITEM` | `OFERTAS`                                             | `itemType` (PRODUCT/SERVICE/null), `status` (o null), `saleUnit`, evidencias, atributos fijos |
| `OPTION`       | `OPCIONES_OFERTA` + `LISTAS`                          | `required` (o null), valores con clave de registro y medida                                   |
| `DECORATION`   | `OFERTA_METODO` / modalidad Blank-Personalizada       | asociación de método con **sugerencia** / política `OPTIONAL`                                 |
| `COMPOSITION`  | `COMPONENTES_OFERTA` / modalidad material-instalación | relación padre → hijo (cantidad, rol) / hipótesis por resolver                                |
| `PRICE`        | grupo de `PRECIOS` + `CONDICIONES_PRECIO`             | una `PriceDefinition` hipotética: modelo, moneda, mercado, base, condiciones, observaciones   |
| `PRESENTATION` | `PRESENTACIÓN_OFERTA` + `PRESENTACIONES`              | nombre, ocasión, idioma/locale, estado de publicación como evidencia                          |

`null` significa "la fuente no lo dice". Nada se completa por defecto: estado desconocido ≠ `CANDIDATE`, `Obligatoria` vacía ≠ `false`, clase vacía ≠ `PRODUCT`. Tablas de mapeo versionadas en `src/import/mappings.ts` (`MAPPING_VERSION`): base de cobro, sugerencias de método, locale.

## Precios

Agrupación: `item × moneda × modelo × base de cobro × conjunto exacto de condiciones` (opción, atributo, operador, valor, unidad). La cantidad es el break. Resultado real v1.2: **131 observaciones → 14 definiciones** (13 matrices exactas con 130 breaks + 1 `FIXED`). Sin interpolación (750 no existe), sin fusiones por nombre. Los 23 históricos quedan como registros con `evidence_class`, jamás como candidato. MXN explícito queda bloqueado como evidencia (`MX_PRICE_EVIDENCE_ONLY`); no se recalcula México.

## Validación → estado de revisión

`validateBatch` calcula por candidato:

- **Bloqueos** (no aprobables): rechazo del parser, issue `ERROR` en sus registros, modelo no soportado, precio sin autorización en la fuente, moneda desconocida, evidencia MXN, breaks en conflicto o duplicados, operador distinto de `Igual`, BUNDLE, nombre o referencia faltante.
- **Campos sin resolver** (requieren decisión humana): p. ej. `status`, `decorationPolicy`, `itemType`, `isRequired`, `methodKey`, `validFrom`, `maxQuantity`, `locale`.
- Estado: `BLOCKED` si hay bloqueos; si no, `WARNING` con campos sin resolver o advertencias; `VALID` en otro caso.

## Comandos

```bash
pnpm import:stage .import/envelopes/*.envelope.json [--rerun] [--lineage KEY]
pnpm import:status
DTG_SOURCES=/ruta/workbooks pnpm import:dry-run   # → docs/import/IMPORT-DRY-RUN-REPORT.md
```
