# Architecture Decision Records

| ADR                                                            | Título                                                              | Origen   |
| -------------------------------------------------------------- | ------------------------------------------------------------------- | -------- |
| [0001](ADR-0001-quantity-distribution.md)                      | Distribución de cantidad (corrida de tallas)                        | STEP 03  |
| [0002](ADR-0002-unset-lifecycle-at-migration.md)               | Estado de catálogo no asignado en migración                         | STEP 03  |
| [0003](ADR-0003-item-market-policy.md)                         | Política Item × Market; México manual estricto (+ addendum STEP 04) | STEP 03  |
| [0004](ADR-0004-decoration-as-priced-selection.md)             | Decoración con precio propio; blank = sin decoración                | STEP 03  |
| [0005](ADR-0005-historical-prices-as-evidence.md)              | Precios históricos sólo como evidencia                              | STEP 03  |
| [0006](ADR-0006-price-breaks.md)                               | Cantidad en `price_break`, no en condiciones                        | STEP 03  |
| [0007](ADR-0007-variant-persistence-deferred.md)               | Persistencia de Variant diferida                                    | STEP 04  |
| [0008](ADR-0008-explicit-money-currency.md)                    | Money con moneda explícita                                          | STEP 04  |
| [0009](ADR-0009-deterministic-pricing-clock.md)                | Reloj explícito (`asOf`) en pricing                                 | STEP 04  |
| [0010](ADR-0010-independent-component-market-resolution.md)    | Mercado resuelto por CatalogItem en componentes                     | STEP 04  |
| [0011](ADR-0011-public-code-format.md)                         | Código público `DTG-00001`                                          | STEP 04  |
| [0012](ADR-0012-local-database-plain-postgres.md)              | PostgreSQL local plano, migraciones propias                         | STEP 04  |
| [0013](ADR-0013-seed-layers.md)                                | Capas: referencia / dev slice / fixtures                            | STEP 04  |
| [0014](ADR-0014-import-interchange-boundary.md)                | Frontera de importación: parser Python + ImportEnvelope v1          | STEP 05B |
| [0015](ADR-0015-generic-staging-and-controlled-publication.md) | Staging genérico, revisión separada, publicación controlada         | STEP 05B |
| [0016](ADR-0016-review-console-drafts-and-audit.md)            | Consola de revisión: borradores, auditoría por campo, actor         | STEP 06  |
| [0017](ADR-0017-price-revision-lineage-and-replay.md)          | Linaje de revisiones, reproducción temporal, autorización de precio | STEP 07  |
| [0018](ADR-0018-quality-engine-and-recorded-answers.md)        | Motor de calidad puro, respuestas registradas, mapeos y marcas      | STEP 08  |
| [0019](ADR-0019-scoped-migration-permit.md)                    | Permiso de migración acotado y publicación REAL por item            | STEP 09  |
| [0020](ADR-0020-candidate-disposition-and-canonicalization.md) | Disposición de candidatos y canonicalización (alias/config/estilo)  | STEP 09+ |
