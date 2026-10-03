# STEP 08 — Data quality dry run (real staging)

Generado por `pnpm quality:report` el 2026-10-01T22:08:43.487Z sobre la base local con el staging real
(1 lotes, 413 candidatos). Todo número se calcula: nada se estima ni se
oculta. Lectura sin escritura (la demostración antes/después corre en una transacción que se revierte; la
base quedó idéntica: verificado).

Lotes: Design_To_Go_Catalog_v1.2_RC_MANGO_TANGO.xlsx (REAL, 413 cand.).
Reglas: 52 (versión 1); publicación habilitada sólo para: FIXTURE.

## 1. Totales

| Medida                                               | Valor |
| ---------------------------------------------------- | ----- |
| Candidatos                                           | 413   |
| Resueltos (sin campos abiertos)                      | 8     |
| Sin resolver                                         | 405   |
| Hallazgos                                            | 1281  |
| BLOCKER                                              | 1053  |
| WARNING                                              | 224   |
| INFO                                                 | 4     |
| Esperan decisión del dueño (OWNER_DECISION_REQUIRED) | 691   |
| Resolubles en masa (BULK_RESOLVABLE)                 | 545   |
| Sólo manual (MANUAL_REVIEW)                          | 45    |
| Corrección en la fuente (SOURCE_FIX)                 | 0     |

## 2. Por tipo de candidato

| Tipo         | Candidatos | Resueltos | Sin resolver |
| ------------ | ---------- | --------- | ------------ |
| CATALOG_ITEM | 220        | 0         | 220          |
| COMPOSITION  | 5          | 4         | 1            |
| DECORATION   | 92         | 4         | 88           |
| OPTION       | 70         | 0         | 70           |
| PRESENTATION | 12         | 0         | 12           |
| PRICE        | 14         | 0         | 14           |

## 3. Por área

| Área         | Hallazgos | Bloqueantes | Advertencias | Info |
| ------------ | --------- | ----------- | ------------ | ---- |
| CATALOG_ITEM | 558       | 554         | 4            | 0    |
| COMPOSITION  | 3         | 3           | 0            | 0    |
| DECORATION   | 88        | 88          | 0            | 0    |
| OPTION       | 337       | 337         | 0            | 0    |
| PRESENTATION | 24        | 24          | 0            | 0    |
| PRICING      | 51        | 47          | 0            | 4    |
| CATEGORY     | 220       | 0           | 220          | 0    |

## 4. Por regla (sólo reglas con hallazgos)

| Regla          | Título                                              | Sev.    | Afectados | En masa | Dueño | Manual | Fuente | Decisión |
| -------------- | --------------------------------------------------- | ------- | --------- | ------- | ----- | ------ | ------ | -------- |
| DQ-CATALOG-001 | Producto/Servicio sin resolver                      | BLOCKER | 3         | 0       | 3     | 0      | 0      | D-003    |
| DQ-CATALOG-002 | Estado de catálogo sin resolver                     | BLOCKER | 197       | 0       | 197   | 0      | 0      | D-001    |
| DQ-CATALOG-003 | Unidad de venta ausente                             | BLOCKER | 119       | 2       | 117   | 0      | 0      | D-002    |
| DQ-CATALOG-004 | Categoría sin mapear                                | WARNING | 220       | 156     | 64    | 0      | 0      | D-009    |
| DQ-CATALOG-005 | Política de decoración sin resolver                 | BLOCKER | 220       | 220     | 0     | 0      | 0      | —        |
| DQ-CATALOG-006 | Material del cliente sin resolver (servicio)        | BLOCKER | 15        | 11      | 4     | 0      | 0      | D-013    |
| DQ-CATALOG-007 | Posible duplicado                                   | WARNING | 4         | 0       | 0     | 4      | 0      | —        |
| DQ-COMP-001    | Composición sin padre o sin hijo                    | BLOCKER | 1         | 0       | 0     | 1      | 0      | —        |
| DQ-COMP-004    | Cantidad de composición ausente o inválida          | BLOCKER | 1         | 0       | 0     | 1      | 0      | —        |
| DQ-COMP-005    | Incluido/Opcional sin resolver                      | BLOCKER | 1         | 0       | 0     | 1      | 0      | —        |
| DQ-DECOR-001   | Método de decoración sin clasificar                 | BLOCKER | 88        | 41      | 47    | 0      | 0      | D-006    |
| DQ-OPTION-001  | Opción obligatoria sin resolver                     | BLOCKER | 70        | 5       | 65    | 0      | 0      | D-004    |
| DQ-OPTION-002  | Definición de opción sin resolver / nombre genérico | BLOCKER | 70        | 0       | 45    | 25     | 0      | D-005    |
| DQ-OPTION-003  | Modo de selección sin resolver                      | BLOCKER | 70        | 5       | 65    | 0      | 0      | D-004    |
| DQ-OPTION-004  | Distribuible sin resolver                           | BLOCKER | 70        | 66      | 4     | 0      | 0      | D-007    |
| DQ-OPTION-005  | Valores de opción sin mapear                        | BLOCKER | 57        | 0       | 44    | 13     | 0      | D-005    |
| DQ-PRES-001    | Presentación sin idioma                             | BLOCKER | 12        | 12      | 0     | 0      | 0      | —        |
| DQ-PRES-002    | Presentación default sin resolver                   | BLOCKER | 12        | 12      | 0     | 0      | 0      | —        |
| DQ-PRICE-003   | Item con precio pero sin unidad de venta            | BLOCKER | 1         | 1       | 0     | 0      | 0      | —        |
| DQ-PRICE-005   | Semántica de cantidad/base sin resolver             | BLOCKER | 1         | 0       | 1     | 0      | 0      | D-010    |
| DQ-PRICE-009   | Vigencia del precio sin decidir                     | BLOCKER | 14        | 14      | 0     | 0      | 0      | —        |
| DQ-PRICE-010   | D-008 · alcance del recargo por talla               | BLOCKER | 21        | 0       | 21    | 0      | 0      | D-008    |
| DQ-PRICE-011   | D-010 · varios pares de imanes                      | BLOCKER | 1         | 0       | 1     | 0      | 0      | D-010    |
| DQ-PRICE-012   | D-011 · tarifas de Yard Sign                        | BLOCKER | 1         | 0       | 1     | 0      | 0      | D-011    |
| DQ-PRICE-013   | D-016 · autoridad para autorizar/publicar precios   | BLOCKER | 4         | 0       | 4     | 0      | 0      | D-016    |
| DQ-PRICE-014   | D-022 · IVA / impuestos México sin resolver         | BLOCKER | 4         | 0       | 4     | 0      | 0      | D-022    |
| DQ-PRICE-016   | Redondeo HALF_UP_2 provisional (México)             | INFO    | 4         | 0       | 4     | 0      | 0      | D-022    |

Reglas sin hallazgos hoy: DQ-CATALOG-009, DQ-COMP-002, DQ-COMP-003, DQ-DECOR-002, DQ-DECOR-003, DQ-DECOR-004, DQ-IMPORT-001, DQ-OPTION-006, DQ-OPTION-007, DQ-OPTION-008, DQ-OPTION-009, DQ-OPTION-010, DQ-PRES-003, DQ-PRES-004, DQ-PRES-005, DQ-PRICE-001, DQ-PRICE-002, DQ-PRICE-004, DQ-PRICE-006, DQ-PRICE-007, DQ-PRICE-008, DQ-PRICE-015, DQ-PROV-001, DQ-PROV-002, DQ-PROV-003.

## 5. Por decisión del dueño (hallazgos ligados)

| Decisión | Título                                         | Hallazgos | Artículos |
| -------- | ---------------------------------------------- | --------- | --------- |
| D-001    | Estado formal del catálogo                     | 197       | 197       |
| D-002    | Unidad de venta pendiente                      | 117       | 117       |
| D-003    | Alcance de tres tipos sin resolver             | 3         | 3         |
| D-004    | Qué datos debe pedir el vendedor               | 130       | 45        |
| D-005    | Significado de opciones genéricas              | 89        | 32        |
| D-006    | Proceso incluido o decoración elegible         | 47        | 40        |
| D-007    | Surtido real de tallas                         | 4         | 3         |
| D-008    | Alcance del recargo por talla                  | 21        | 21        |
| D-009    | Ubicación de familias que se solapan           | 64        | 64        |
| D-010    | Pedidos de varios pares de imanes              | 2         | 1         |
| D-011    | Tarifas de Yard Sign                           | 1         | 1         |
| D-012    | Llavero y Llavero UV DTF                       | 0         | 0         |
| D-013    | Servicios sobre material del cliente           | 4         | 4         |
| D-014    | Manga larga y Sudadera retenidos               | 0         | 0         |
| D-015    | Ficha operativa de transfers                   | 0         | 0         |
| D-016    | Autorización para publicar                     | 4         | 4         |
| D-017    | Compatibilidad de displays y alcance de canopy | 0         | 0         |
| D-018    | Invitaciones legacy frente a Formal/Casual     | 0         | 0         |
| D-019    | Evidencia para PPE                             | 0         | 0         |
| D-020    | Tabla waterproof faltante                      | 0         | 0         |
| D-021    | Alcance de instalación                         | 0         | 0         |
| D-022    | Redondeo e impuestos México                    | 8         | 4         |

Ninguna decisión está respondida en el staging real: lo que depende de ellas figura como
`OWNER_DECISION_REQUIRED`, no como error técnico.

## 6. Preparación (4 dimensiones, 220 artículos)

| Dimensión   | Estados                      |
| ----------- | ---------------------------- |
| Revisión    | NEEDS_RESOLUTION: 220        |
| Dominio     | BLOCKED: 220                 |
| Precios     | QUOTE_ONLY: 216 · BLOCKED: 4 |
| Publicación | BLOCKED: 220                 |

Listos si se levantara la barrera de publicación REAL (que sigue cerrada): **0**.

## 7. Subconjunto Commercial Print (21 artículos)

Hallazgos de esos artículos: 168 (BLOCKER 143, WARNING 21, INFO 4).
Detalle por artículo en `COMMERCIAL_PRINT_MIGRATION_GATE.md`.

## 8. Demostración antes / después (transacción revertida)

Se registró una respuesta **hipotética** a D-001 («todos ACTIVE») con el rol de registro, se previsualizó y se
aplicó con el flujo real (origen DECISION_GROUP). **No es una decisión del dueño**: sólo muestra qué hace la
herramienta. Después se hizo `rollback`.

| Medida                                                     | Antes | Con la respuesta aplicada |
| ---------------------------------------------------------- | ----- | ------------------------- |
| Hallazgos DQ-CATALOG-002 (estado de catálogo sin resolver) | 197   | 0                         |
| Candidatos sin resolver                                    | 405   | 405                       |
| Hallazgos totales                                          | 1281  | 1084                      |
| BLOCKER                                                    | 1053  | 856                       |
| Esperan decisión del dueño                                 | 691   | 494                       |
| Artículos listos (dominio)                                 | 0     | 0                         |

Campos escritos en la demostración: 197 en 197 candidatos. Hallazgos que desaparecen:
197; aparecen: 0 (los demás bloqueos — unidad de venta, opciones,
precios, decisiones — siguen visibles).
