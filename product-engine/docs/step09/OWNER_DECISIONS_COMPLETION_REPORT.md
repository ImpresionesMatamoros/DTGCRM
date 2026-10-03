# STEP 09 completion — Informe final de la pasada Owner Decisions

Generado por `tsx scripts/step09-completion-report.ts final --completion` (2026-10-02T09:01:03.387Z). Esta pasada continúa STEP 09 (no lo reinicia ni empieza STEP 10). Los documentos de STEP 09 se conservan; esto se suma.

## 1. HEAD inicial y final

- **HEAD inicial:** `c2897e7eb4cfc94f08c13adfdddb3825c5afcec4` (rama `step09/commercial-print-mvp`) — verificado contra el zip del baseline.
- **Rama de continuación:** `step09/owner-decisions-completion`.
- **HEAD de código al generar este informe:** `15d2cc8894af23eff41d4ebfcb2f208ad81f30ed` (los commits de documentación posteriores no cambian código; el HEAD final queda en el zip entregado).

## 2. Commits de la pasada (hasta el generado de este informe)

- `15d2cc8` feat: completion final report generator; canonical names in the dry-run table
- `9234ab3` fix: run the e2e suites that write test decisions on a database copy; verify owner answers are reflected in staging; alias dev-slice item check
- `795f08c` test: disposition audit and trigger message assertions
- `5ebc87d` docs: ADR-0020, DATABASE/DECISIONS/MIGRATION notes; test: match import-history trigger messages
- `c685ede` feat: owner decisions completion — candidate disposition (0018), RESOLVED gate verdict, completion driver, reports and tests
- `e3f37b5` docs: owner decisions completion assessment

## 3. Migraciones

- **0018_candidate_disposition.sql** (única nueva): tabla append-only `candidate_disposition`. 0001–0017 sin cambios. Ver ADR-0020.

## 4. Decisiones del dueño registradas (`owner_decision_answer`, evidencia: OWNER_DECISION_SPEC_v1.0)

| Decisión | Rev. | Actor  | Respuesta                                                                                                                                                                                                                  |
| -------- | ---- | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D-001    | 1    | martin | OD-01: ACTIVE = DTG vende/cotiza el item hoy (ACTIVE + QUOTE_ONLY es válido). Confirmados en Commercial Print: Business Cards, Flyers, Postcards y Auto Magnets.                                                           |
| D-001    | 2    | martin | Owner spec v1.0: ACTIVE = Tabloide/Poster 11×17, Poster Gran Formato, Menús, Invitación Sencilla, Invitación Premium, Periódico personalizado (además de los ya confirmados). CANDIDATE = Seating/Place Cards y Thank-you… |
| D-002    | 1    | martin | OD-02: la mayoría de los productos se vende por PIECE; excepciones Business Cards, Flyers y Stickers (cantidades/lotes definidos). Un paquete no es un CatalogItem aparte.                                                 |
| D-002    | 2    | martin | Owner spec v1.0: la mayoría de los productos tangibles se vende por PIECE (Tabloide 11×17, Menús, Invitaciones, Periódico, Seating, Thank-you); Poster Gran Formato se mide por área (SQ_FT, medidas estándar y personali… |
| D-003    | 1    | martin | Owner spec v1.0: tangible = PRODUCT, intangible = SERVICE. El periódico personalizado para eventos es un PRODUCT físico.                                                                                                   |
| D-004    | 1    | martin | Owner spec v1.0 (decisiones 11–14 y 3): Menús — tamaño, 1 o 2 caras y laminado opcional son opciones comerciales del cliente; el material es decisión interna salvo diferencia comercial. Invitación con acrílico es una … |
| D-005    | 1    | martin | Owner spec v1.0 (decisión 13): "Laminado" en Menús es una opción comercial opcional cuando se ofrece; no se asume que el menú genérico sea sin laminado. Las opciones "presentación/acabado" de Invitación con acrílico q… |
| D-010    | 1    | martin | OD-08: Auto Magnets = 65 USD por 1 PAR (cada imán 1×2 ft, impresión incluida). No se asume 2 pares = 2×; otras cantidades quedan QUOTE_ONLY.                                                                               |
| D-016    | 1    | martin | OD-05 + OD-07: Martín autoriza el precio maestro y la primera publicación REAL de un producto (v0.1). Jonathan y Ceci preparan, editan y revisan; no autorizan. Delegable después.                                         |
| D-018    | 1    | martin | Owner spec v1.0: canónicas Invitación Sencilla e Invitación Premium; "Invitación para evento" = etiqueta genérica; "con sobre" = configuración; "con sello" y "con acrílico" = configuraciones de Premium; "Invitación es… |

Cada disposición apunta a la respuesta vigente de su decisión (`decision_answer_id`; verificado: OK). Las respuestas las registró la sesión a nombre de Martín (actor `martin`) con la spec firmada como evidencia: Martín debe revisarlas en Admin.

## 5. Las 21 filas fuente y las 16 que estaban bloqueadas

| Legacy       | Fila fuente                            | Antes     | Tratamiento final                          | Resultado                                                |
| ------------ | -------------------------------------- | --------- | ------------------------------------------ | -------------------------------------------------------- |
| MIG1-O-008   | Tarjeta Tradicional                    | PUBLICADA | PRODUCTO (ya publicado en STEP 09)         | DTG-00001 Tarjeta de presentación Tradicional            |
| MIG1-O-009   | Tarjeta Premium / Gloss                | PUBLICADA | PRODUCTO (ya publicado en STEP 09)         | DTG-00002 Tarjeta de presentación Premium / Gloss        |
| MIG2-O-036   | Flyers                                 | PUBLICADA | PRODUCTO (ya publicado en STEP 09)         | DTG-00003 Flyers                                         |
| MIG2-O-037   | Tabloides                              | BLOQUEADA | PRODUCTO canónico ACTIVE (QUOTE_ONLY)      | DTG-00034 «Poster / Tabloide 11×17» · PIECE              |
| MIG2-O-038   | Posters                                | BLOQUEADA | PRODUCTO canónico ACTIVE (QUOTE_ONLY)      | DTG-00035 «Poster Gran Formato» · SQ_FT                  |
| MIG2-O-039   | Menús                                  | BLOQUEADA | PRODUCTO canónico ACTIVE (QUOTE_ONLY)      | DTG-00036 «Menús» · PIECE                                |
| MIG2-O-040   | Postales                               | PUBLICADA | PRODUCTO (ya publicado en STEP 09)         | DTG-00033 Postales                                       |
| MIG2-O-046   | Tarjetas complementarias               | BLOQUEADA | NO-PRODUCTO: LEGACY_INVALID                | evidencia conservada, sin producto (D-001)               |
| MIG2-O-047   | Seating card / place card              | BLOQUEADA | PRODUCTO interno CANDIDATE (nunca público) | DTG-00037 «Seating card / place card» · PIECE            |
| MIG2-O-048   | Thank-you card                         | BLOQUEADA | PRODUCTO interno CANDIDATE (nunca público) | DTG-00038 «Thank-you card» · PIECE                       |
| MIGF-O-008   | Invitación sencilla                    | BLOQUEADA | PRODUCTO canónico ACTIVE (QUOTE_ONLY)      | DTG-00039 «Invitación sencilla» · PIECE                  |
| MIGF-O-009   | Invitación premium                     | BLOQUEADA | PRODUCTO canónico ACTIVE (QUOTE_ONLY)      | DTG-00040 «Invitación premium» · PIECE                   |
| MIGF-O-010   | Invitación para evento                 | BLOQUEADA | NO-PRODUCTO: ALIAS                         | → MIGF-O-008, MIGF-O-009 (D-018)                         |
| MIGF-O-011   | Invitación con sobre                   | BLOQUEADA | NO-PRODUCTO: CONFIGURATION                 | → MIGF-O-008, MIGF-O-009 (D-018)                         |
| MIGF-O-012   | Invitación con sello                   | BLOQUEADA | NO-PRODUCTO: CONFIGURATION                 | → MIGF-O-009 (D-018)                                     |
| MIGF-O-013   | Invitación con acrílico                | BLOQUEADA | NO-PRODUCTO: CONFIGURATION                 | → MIGF-O-009 (D-018)                                     |
| MIGF-O-014   | Invitación especial                    | BLOQUEADA | NO-PRODUCTO: LEGACY_INVALID                | evidencia conservada, sin producto (D-018)               |
| MIGF-O-015   | Imanes para vehículo — par de 2 × 1 ft | PUBLICADA | PRODUCTO (ya publicado en STEP 09)         | DTG-00004 Imanes para vehículo — par 2 × 1 ft            |
| OWN-MT-O-046 | Periódico personalizado para eventos   | BLOQUEADA | PRODUCTO canónico ACTIVE (QUOTE_ONLY)      | DTG-00041 «Periódico personalizado para eventos» · PIECE |
| OWN-O-007    | Invitación formal                      | BLOQUEADA | NO-PRODUCTO: STYLE                         | → MIGF-O-008, MIGF-O-009 (D-018)                         |
| OWN-O-008    | Invitación casual                      | BLOQUEADA | NO-PRODUCTO: STYLE                         | → MIGF-O-008, MIGF-O-009 (D-018)                         |

## 6. Productos canónicos antes y después

| Medida                                                       | Antes (fin STEP 09) | Después |
| ------------------------------------------------------------ | ------------------- | ------- |
| Productos Commercial Print en Product Engine (REAL, permiso) | 5                   | 13      |
| … ACTIVE                                                     | 5                   | 11      |
| … CANDIDATE (internos, nunca públicos)                       | 0                   | 2       |
| Filas fuente resueltas como no-producto                      | 0                   | 8       |
| Filas bloqueadas                                             | 16                  | 0       |
| Precios AUTORIZADOS (sin cambios: no se inventó ninguno)     | 14                  | 14      |
| CatalogItems en total (incluye el dev slice)                 | 17                  | 25      |

## 7. Publicado ahora

| Código    | Legacy       | Producto                             | Estado    | Unidad | Categoría      | Opciones | Precios AUTH |
| --------- | ------------ | ------------------------------------ | --------- | ------ | -------------- | -------- | ------------ |
| DTG-00034 | MIG2-O-037   | Poster / Tabloide 11×17              | ACTIVE    | PIECE  | impresos_papel | 0        | 0            |
| DTG-00035 | MIG2-O-038   | Poster Gran Formato                  | ACTIVE    | SQ_FT  | impresos_papel | 0        | 0            |
| DTG-00036 | MIG2-O-039   | Menús                                | ACTIVE    | PIECE  | impresos_papel | 1        | 0            |
| DTG-00037 | MIG2-O-047   | Seating card / place card            | CANDIDATE | PIECE  | impresos_papel | 0        | 0            |
| DTG-00038 | MIG2-O-048   | Thank-you card                       | CANDIDATE | PIECE  | impresos_papel | 0        | 0            |
| DTG-00039 | MIGF-O-008   | Invitación sencilla                  | ACTIVE    | PIECE  | impresos_papel | 0        | 0            |
| DTG-00040 | MIGF-O-009   | Invitación premium                   | ACTIVE    | PIECE  | impresos_papel | 0        | 0            |
| DTG-00041 | OWN-MT-O-046 | Periódico personalizado para eventos | ACTIVE    | PIECE  | impresos_papel | 0        | 0            |

Ninguno tiene precio: ACTIVE + QUOTE_ONLY es válido y preferible a inventar (decisiones 107/126). Los códigos públicos pueden tener huecos (ADR-0011: las pruebas consumen la secuencia).

## 8. Qué no se publica y por qué

- **8 filas no-producto** (alias, configuraciones, estilos, legacy no válido): su evidencia sigue en staging (candidatos rechazados con razón y celdas de origen); no son CatalogItems.
- **Seating card y Thank-you card** se migraron sólo como registros internos con estado CANDIDATE: ningún perfil de publicación admite CANDIDATE (verificado: 2 items, 0 membresías públicas).
- **Otras categorías** (Apparel, Displays, etc.): fuera del permiso (0 publicaciones fuera de alcance).
- **Precios y tramos**: Menús (1 y 6), Invitaciones (12…300), Posters, Periódico y Postales siguen sin precio autorizado; la semántica de tramo alcanzado ya existe (`TIERED`) y está probada, sin datos de precio.

## 9. Data Quality antes → después (todo el staging real)

| Medida                       | Antes | Después |
| ---------------------------- | ----- | ------- |
| Candidatos                   | 407   | 391     |
| Hallazgos                    | 1212  | 1122    |
| Bloqueantes                  | 989   | 915     |
| Requieren decisión del dueño | 678   | 633     |

Bloqueos de Commercial Print que desaparecen: D-001 (16 filas), D-002 (16), D-003 (1), D-004/D-005 (2), D-018 (9). Detalle por fila en `OWNER_DECISIONS_POST_QUALITY.md`. No se esconde ningún hallazgo ajeno (otras categorías siguen con los suyos).

## 10. Pendientes

**P1 (bloquean la operación de Commercial Print):** ninguno. Las 21 filas están resueltas y 0 bloqueadas.

**P2 (no bloquean; requieren confirmación o trabajo posterior):**

- Autorizar precios maestros de Martín para Menús (tramos 1 y 6; siguientes por definir), Invitaciones (12…300), Poster/Tabloide 11×17, Poster Gran Formato (por área, mínimo), Periódico y Postales. Hasta entonces se cotizan.
- **Poster Gran Formato (MIG2-O-038):** el workbook no distingue "Tabloides" y "Posters" (mismos datos fuente). Se asignó por el mapa del dueño y por descarte (037 ya es el 11×17). Confirmar que la identidad es correcta.
- Configuraciones de Invitación Premium (sello, acrílico, sobre) quedan registradas como disposición hacia el producto canónico; "con sobre" apunta a ambas invitaciones sin afirmar cuál lo ofrece. No se materializan como opciones/recargos hasta que exista el recargo autorizado.
- Menús: tamaño y 1/2 caras son opciones del cliente según el dueño, pero el workbook no trae sus valores; no se inventaron (sólo existe la opción "Laminado").
- **DTG-00016 «Invitación para evento»** ya existía en el dev slice (sin estado, nunca público) con el ID legacy del alias MIGF-O-010. No lo creó ni lo activó esta pasada; conviene retirarlo desde Admin con el visto bueno del dueño.
- D-009 (ubicación del imán en la navegación) y D-022 (México) siguen abiertas y no bloquean.
- Respuestas D-004/D-005/D-018 y categorías las registró la sesión a nombre del dueño; revisión humana pendiente en Admin.

## 11. Pruebas

| Suite                                                   | Resultado                                                                             |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Unit                                                    | 258 passed                                                                            |
| DB                                                      | 133 passed                                                                            |
| Importer (Python)                                       | 39 tests                                                                              |
| Playwright · migración STEP 09                          | 9 passed                                                                              |
| Playwright · suites STEP 06–08 (sobre copia de la base) | 19 passed                                                                             |
| Playwright · pasada Owner Decisions                     | 8 passed                                                                              |
| Casos de precio por el Price Engine                     | 13/13 OK (120.00 / 400.00 / 65.00, 750 y 2 pares QUOTE_ONLY, nuevos items QUOTE_ONLY) |
| Idempotencia de la publicación                          | segunda ejecución: 0 filas nuevas (conteos idénticos)                                 |
| Procedencia de candidatos publicados                    | 34/34                                                                                 |
| Duplicados (enlaces / ids legacy / códigos)             | 0 / 0 / 0                                                                             |
| Publicados fuera del alcance / del permiso              | 0 / 0                                                                                 |

## 12. Reconstrucción limpia e integridad de los workbooks

`tools/step09-rebuild.sh` en un clone nuevo con base vacía: schema 0001–0018 → importación → STEP 09 → pasada Owner Decisions → reportes → todas las suites. Los dos hashes (antes/después) de los 5 workbooks son idénticos (**workbooks sin cambios**):

```
9228c5f8bc4655cdd38f9be4a71e586c272c8305b0c658269c7b832049c2d532  DTG_CATALOG_COSTING_EXTENSION_v1.1_TEST_PILOT.xlsx
fdfc0a9123f0b0d30f8d6c654694df4b2146e3f51e7303be87fca8f2b0951dab  DTG_COMPREHENSION_MAP_v0.1.xlsx
88eb9be1693d1864f3e2f1c68d8e060c801e8bbabeff6aa24643ea297c5dbe27  DTG_GORRAS_DEEP_DIVE_v0.1.xlsx
9cf5dc7bc3b2c53947a9ea2f4fdb271d2c77f542f6ecf514e8e55c81ed4d99fd  Design_To_Go_Catalog_v1.1_POST_OWNER_INTERVIEW_PATCHED.xlsx
41b4fc07c5056299e13c8ce7108e3ae57ed7d6830b37828a0caf7f9b9fd17534  Design_To_Go_Catalog_v1.2_RC_MANGO_TANGO.xlsx
```

## 13. ¿Commercial Print está suficientemente resuelto para STEP 10?

**Sí.** Las 21 filas fuente tienen una identidad canónica o una disposición documentada; 13 productos viven en Product Engine (11 ACTIVE, 2 CANDIDATE internos) con procedencia hasta la celda del Excel; los precios que existen se resuelven por el Price Engine y todo lo demás cotiza sin inventar. STEP 10 (CRM) debe tratar los items QUOTE_ONLY como "solicitar cotización", ignorar CANDIDATE y no ver las filas no-producto. No se empezó STEP 10.
