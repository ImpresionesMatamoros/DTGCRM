# Base de datos

PostgreSQL 16 (compatible con Supabase). **Git es la única fuente del esquema**: todo cambio estructural es un archivo en `supabase/migrations/`, aplicado en orden y registrado con su checksum en `schema_migrations`. Una migración aplicada no puede modificarse (el runner falla); se crea una nueva.

## Migraciones

| Archivo                           | Contenido                                                                                                                                                                    |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `0001_catalog_core.sql`           | Enums base, secuencia y función `next_public_code()`, `catalog_item` y trigger de guarda (id y código inmutables, status no vuelve a NULL)                                   |
| `0002_categories.sql`             | `category`, `catalog_item_category` (≤1 primaria)                                                                                                                            |
| `0003_options.sql`                | `option_definition`, `option_value` (spec según tipo), `item_option` (distribuible sólo ENUM SINGLE), `item_option_value` (FK compuesta: el valor pertenece a la definición) |
| `0004_decoration.sql`             | `decoration_method`, `decoration_capability` (prohibida si el item es `NONE`)                                                                                                |
| `0005_composition.sql`            | `composition_line` (INCLUDED/OPTIONAL, sin ciclos, profundidad ≤ 2)                                                                                                          |
| `0006_markets_and_pricebooks.sql` | `market`, `price_book`, `item_market_policy` (persistente), `pricing_parameter` (sin traslapes, `btree_gist`)                                                                |
| `0007_pricing.sql`                | `price_definition`, `price_break`, `price_rule`, `price_rule_assignment`, `price_condition` + guardas                                                                        |
| `0008_presentations.sql`          | `presentation` (≤1 default por idioma)                                                                                                                                       |
| `0009_publications.sql`           | `publication_profile`, `publication_assignment`, vista `v_publication_membership`                                                                                            |
| `0010_provenance.sql`             | `source_reference`, `decision_record`, `decision_subject`                                                                                                                    |
| `0011_change_events.sql`          | `change_event` append-only, triggers de auditoría, vista `v_revisions`                                                                                                       |
| `0012_import_staging.sql`         | Staging de importación (STEP 05B): `import_batch`, `import_record`, `import_candidate`, `import_candidate_source`, `import_issue`; append-only; guardas histórico/TEST       |
| `0013_import_review.sql`          | `import_candidate_link` (staging → dominio), transiciones de revisión, scope `IMPORT` en `change_event`                                                                      |

## Invariantes aplicadas por la base

- `public_code` `^DTG-[0-9]{5,}$`, único, inmutable.
- `status` nullable sólo como “no asignado”; nunca vuelve a NULL.
- `customer_supplied_item` sólo en `SERVICE`; `merged_into_id` sólo con `RETIRED`.
- Precios: forma por modelo (checks); `AUTHORIZED` requiere autorizador, unidad de venta del item, breaks en matrices y ninguna definición idéntica y vigente superpuesta; datos `AUTHORIZED/SUPERSEDED` inmutables (sólo se cierran con `SUPERSEDED` + `valid_to`) y no se borran; breaks y condiciones congelados.
- Reglas: `REQUIRE_QUOTE` sin importe, las demás con importe; inmutables al autorizarse.
- Política `DERIVED` sólo en mercados con price book derivado; `factor_override` sólo con `INHERIT/DERIVED`.
- FX sin vigencias superpuestas.
- `change_event` no se puede modificar ni borrar.
- Staging (`import_*`): no se borra; registros, fuentes, issues y enlaces son inmutables; la propuesta de un candidato no cambia; evidencia histórica y filas TEST no alimentan candidatos; `BLOCKED` nunca pasa a `APPROVED`; `PUBLISHED` exige enlace de dominio. Ver [import/STAGING](import/STAGING.md).

## Flujo para autorizar un precio

1. Insertar `price_definition` en `DRAFT`.
2. Insertar `price_break` y `price_condition`.
3. `update … set status = 'AUTHORIZED', authorized_by, authorized_at`.

Cambiar un precio vigente = nueva versión (`supersedes_id`) y cerrar la anterior como `SUPERSEDED`.

## Qué NO está en el esquema

`variant`, `variant_option_value`, `bundle_line`, `brand`, `supplier`, `sourcing_option`, inventario, compras, work orders, producción, cotizaciones, clientes, tablas de staging por concepto (`staging_product`, `staging_price`…). Una prueba (`tests/db/schema.test.ts`) falla si aparecen.

## Seguridad local

Sin RLS ni roles de API todavía (P1-06): sólo desarrollo local. El runner se niega a operar contra hosts no locales.

## Migración 0015 (STEP 07)

`change_event.reason`; `price_definition.lineage_id` / `superseded_by_id` / `superseded_at`; índices únicos de linaje; `price_definition_find_clash`; trigger diferido `price_definition_commit_check`; guardas más estrictas. Migraciones 0001–0014 intactas.

## Migración 0016 (STEP 08)

Tablas append-only (sin UPDATE/DELETE, con auditoría `record_change('IMPORT')`): `owner_decision_answer` (respuesta del dueño registrada: decisión, respuesta, resumen, notas, actor, fecha, `supersedes_id` único), `category_mapping` (categoría de origen → `category.key`, candidatos afectados, actor, operación masiva) y `quality_mark` (marcas DISTINCT/REVIEWED de pares de duplicados). Además `review_bulk_operation.decision_answer_id` (obligatorio para origen DECISION_GROUP en filas nuevas; la restricción es NOT VALID para no reescribir historia). Los hallazgos de calidad **no** se guardan.

## Migración 0017 (STEP 09)

Tres tablas append-only con auditoría `record_change('IMPORT')`: `migration_permit` (alcance, mercados, estado ACTIVE/REVOKED, aprobador, fecha, motivo, referencias a respuestas de decisión, decisiones eximidas, ids legacy del alcance, `supersedes_id` único), `migration_permit_item` (candidatos exactos que el permiso incluye) y `migration_publication` (un renglón por candidato publicado, `candidate_id` único; actor, hora y resultado). Un trigger diferido (`migration_publication_guard`) rechaza publicaciones de candidatos que no estén en un permiso activo ni PUBLISHED. 0001–0016 intactas. Ver ADR-0019.

## Migración 0018 (STEP 09 · Owner Decisions)

Una tabla append-only con auditoría `record_change('IMPORT')`: `candidate_disposition` (fila fuente, `ALIAS | CONFIGURATION | STYLE | LEGACY_INVALID`, ids legacy canónicos —vacíos sólo para LEGACY_INVALID, lo exige un CHECK—, detalle, decisión y respuesta registrada, actor, `supersedes_id` único). Explica las filas que no se vuelven CatalogItem sin perder su evidencia. 0001–0017 intactas. Ver ADR-0020.
