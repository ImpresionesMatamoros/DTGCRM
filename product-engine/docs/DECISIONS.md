# Decisiones de implementación (STEP 04)

Registro corto de decisiones y desviaciones respecto a STEP 03. Las decisiones estructurales tienen ADR en [`adr/`](adr/README.md).

## Boundary patches aplicados

| Patch                            | Implementación                                                                          | ADR             |
| -------------------------------- | --------------------------------------------------------------------------------------- | --------------- |
| 1 · Variant conceptual           | Sin tablas `variant`/`variant_option_value`; el contrato no acepta `variant_id`         | 0007            |
| 2 · Money con moneda             | `Money` único; aritmética entre monedas lanza error; wire con string decimal + moneda   | 0008            |
| 3 · Reloj explícito              | `resolvePrice(request, snapshot, asOf)`; lint + prueba impiden leer el reloj            | 0009            |
| 4 · Mercado por item             | Componentes opcionales se resuelven con su propia política de mercado                   | 0010            |
| 5 · ItemMarketPolicy persistente | Tabla `item_market_policy` (`DERIVED` + factor, `MANUAL`, `QUOTE_ONLY`, disponibilidad) | 0003 (addendum) |

## Desviaciones respecto a STEP 03

| #   | STEP 03                                                   | Implementado                                                                                      | Motivo                                                                       |
| --- | --------------------------------------------------------- | ------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| D1  | `item_type` incluía `BUNDLE`                              | Enum `PRODUCT \| SERVICE`                                                                         | Sin evidencia de bundles; ampliar el enum es aditivo                         |
| D2  | Supabase CLI local                                        | PostgreSQL 16 plano + runner propio                                                               | Más simple; Docker Hub no accesible en el entorno de construcción (ADR-0012) |
| D3  | RLS y rol de servicio en migración 0012                   | No implementado                                                                                   | Foundation es local; el acceso del CRM llega con la API (P1-06)              |
| D4  | `sourcing_override`, `variant_id` en `PriceRequest`       | Eliminados                                                                                        | Sourcing y variantes no se persisten todavía                                 |
| D5  | Composición con roles `REQUIRED`/`REPLACEMENT` reservados | Enum sólo `INCLUDED`/`OPTIONAL`                                                                   | Sin caso real (auditoría STEP 03)                                            |
| D6  | Componentes opcionales en el mismo price book del padre   | Resolución independiente por item                                                                 | Patch 4                                                                      |
| D7  | Seed de referencia escrito a mano                         | Ambos seeds generados desde datasets tipados                                                      | Una sola fuente para BD y pruebas; `seed:check` en CI                        |
| D8  | “131 breaks”                                              | 130 breaks + 1 definición `FIXED` (imanes) = 131 tarifas                                          | Precisión del conteo                                                         |
| D9  | `PriceResult` sin líneas conocidas en QUOTE_ONLY          | Se agregan `knownLines` y la línea `MARKET_DERIVATION`                                            | Explicabilidad sin inventar total                                            |
| D10 | Revisión por conjunto de cambios                          | Revisión monótona por fila modificada (`change_event`)                                            | Simple y suficiente; granularidad por transacción queda como deuda           |
| D11 | Capacidad de decoración libre                             | La base impide capacidades en items `decoration_policy = NONE`                                    | Coherencia (tarjetas no se “decoran”)                                        |
| D12 | `PriceRule` sin etiqueta                                  | Campo `label`                                                                                     | Explicación legible en el breakdown                                          |
| D13 | FX `16.5`                                                 | Valor canónico `16.50`                                                                            | Normalización decimal consistente BD ↔ dominio                               |
| D14 | Sale unit supuesta en componentes y servicios             | `null` cuando el Excel no la tenía (estructura/gráfica X-Banner, aplicación DTF, DTF, invitación) | No inventar; sin unidad no hay precio automático                             |

## Decisiones cerradas en STEP 04

- **P1-04 cerrado:** código público `DTG-00001` aprobado (ADR-0011).
- Métodos de decoración de referencia: `DTF`, `EMBROIDERY`, `SCREEN_PRINTING`, `HTV`.
- Monedas: enum `USD`, `MXN` (no tabla: vocabulario cerrado).

# Decisiones de STEP 05B (importación)

| #   | Tema                              | Decisión                                                                                                                                                     | ADR  |
| --- | --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---- |
| I1  | Parser                            | Se conserva el parser Python 05A sin cambios (v0.1.0) en `tools/excel-importer`; no se reescribe en TypeScript                                               | 0014 |
| I2  | Frontera                          | `ImportEnvelope` v1 (JSON snake_case versionado) validado con Zod; JSON Schema generado                                                                      | 0014 |
| I3  | Presentaciones                    | Candidatos `PRESENTATION` agregados en el interchange (no en `mapper.py`), por enlace `PRESENTACIÓN_OFERTA`                                                  | 0014 |
| I4  | Staging                           | 6 tablas genéricas `import_*`; sin tablas por concepto; append-only                                                                                          | 0015 |
| I5  | Precios                           | 131 observaciones → 14 hipótesis de `PriceDefinition` (13 matrices / 130 breaks + 1 FIXED); publicadas siempre como `DRAFT`                                  | 0015 |
| I6  | Desconocidos                      | `null` = desconocido; cada hueco requiere resolución explícita (estado, clase, obligatoria, política de decoración, vigencia, cantidad FIXED)                | 0015 |
| I7  | Revisión                          | `import_review_status` disjunto de `catalog_status`; transiciones guardadas en la base; `BLOCKED` nunca se aprueba                                           | 0015 |
| I8  | Publicación                       | Un candidato a la vez; sólo lotes `FIXTURE` en 05B; `REAL` sólo validación y vista previa                                                                    | 0015 |
| I9  | Linaje                            | `LEGACY_ID` en `source_reference` es el índice de linaje; `CREATE` duplicado ⇒ `LINEAGE_EXISTS`; conciliación con `LINK_EXISTING`                            | 0015 |
| I10 | Métodos de decoración             | Etiquetas Excel sólo **sugieren** un método (DTF textil→DTF, Bordado→EMBROIDERY, Serigrafía→SCREEN_PRINTING, HTV→HTV); procesos de producción sin sugerencia | —    |
| I11 | Base de cobro                     | `Por paquete` y `Total` ⇒ break `TOTAL` (MIGRATION-MAPPING §7); otras bases quedan sin resolver                                                              | —    |
| I12 | Condiciones sobre atributos fijos | Condiciones de precio sobre atributos de valor único del item (par, 2 × 1 ft) no son condiciones: se omiten con nota                                         | —    |
| I13 | Redondeo MX / IVA                 | Sin cambios: `ROUND_HALF_UP` a 2 decimales sigue provisional (P1-02); la importación no calcula ni corrige precios de México                                 | —    |

## Desviaciones respecto al plan de STEP 05A

| #   | STEP 05A proponía                             | Implementado                                                                     | Motivo                                              |
| --- | --------------------------------------------- | -------------------------------------------------------------------------------- | --------------------------------------------------- |
| X1  | Aprobaciones como artefacto separado firmado  | Resolución + `approval_sha256` en `import_candidate`, auditado en `change_event` | Misma garantía (ligada a hash) sin otro almacén     |
| X2  | Mapear el vocabulario con "tablas de mapping" | `src/import/mappings.ts` versionado (`MAPPING_VERSION`) + resolución humana      | Pocas entradas; la decisión final siempre es humana |

# Decisiones de STEP 06 (Admin MVP / Review Console)

| #   | Tema                 | Decisión                                                                                                                | ADR  |
| --- | -------------------- | ----------------------------------------------------------------------------------------------------------------------- | ---- |
| A1  | Borradores           | En `import_candidate.resolution` (esquema parcial); aprobar sigue siendo `approveCandidate`                             | 0016 |
| A2  | Campos abiertos      | `open_fields` calculado con `unresolvedFields` al guardar                                                               | 0016 |
| A3  | Auditoría            | `review_event` + `review_bulk_operation`, append-only                                                                   | 0016 |
| A4  | Actor                | `change_event.changed_by` = `dtg.actor`; `context` = acción del Admin                                                   | 0016 |
| A5  | Categoría            | `categoryKey` explícito + `ASSIGN_CATEGORY`; `categoryLegacy` sólo evidencia; no bloquea aprobar                        | 0016 |
| A6  | Artículo del cliente | Vocabulario del dominio (NOT_APPLICABLE/ALLOWED/REQUIRED), sólo SERVICE; sin booleano                                   | —    |
| A7  | Composición          | INCLUDED/OPTIONAL; sin REQUIRED; sin editor                                                                             | —    |
| A8  | Autorizar precios    | Sin action; botón deshabilitado; `price.authorize` sin otorgar (P1-06)                                                  | —    |
| A9  | Edición de items     | Nombre, estado, unidad, política, artículo del cliente, descripción, categoría. `id`, `public_code` y `kind` inmutables | —    |
| A10 | Alta de items        | Estado y política obligatorios y sin preselección; categoría, unidad y descripción opcionales                           | —    |
| A11 | México               | Sólo `resolvePrice`; HALF_UP_2 marcado provisional; IVA sin resolver                                                    | —    |
| A12 | Actor local          | `DTG_ADMIN_ACTOR` o cookie; sin actor no hay mutaciones                                                                 | —    |
| A13 | Masivos              | Un tipo, campos escalares, vista previa con hash, distintos sólo con confirmación, sin aprobación ni publicación masiva | 0016 |
| A14 | UI                   | CSS propio, sin librería de componentes; filtros GET; E2E con `@playwright/test` (devDependency)                        | —    |

## STEP 07

Las decisiones D-001…D-022 se muestran en la app como referencia de sólo lectura; ninguna fue resuelta. D-016 (autorización de precios) sigue abierta; ver `docs/step07/DECISION-INTELLIGENCE.md`.

## STEP 08

Motor de calidad puro con hallazgos recalculados (no guardados), preparación en cuatro dimensiones sin puntaje, respuestas de decisión registradas con actor (nunca automáticas), mapeo de categorías y marcas de duplicados sin fusión. Ver ADR-0018 y `docs/step08/`. Migración 0016.

## STEP 09 · pasada Owner Decisions

`OWNER_DECISION_SPEC_v1.0` (140 decisiones aprobadas por Martín, 2 correcciones: bundles = capacidad futura; referencia de mercado puede proponerla la IA, siempre consultiva). Se aplicó a las 16 filas bloqueadas: 8 productos canónicos (6 ACTIVE + 2 CANDIDATE, sin precios inventados) y 8 filas no-producto con disposición (alias/configuración/estilo/legacy). Ver ADR-0020 y `docs/step09/OWNER_DECISIONS_COMPLETION_REPORT.md`.
