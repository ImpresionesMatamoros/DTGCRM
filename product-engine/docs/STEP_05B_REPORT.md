# STEP 05B — Import Pipeline Integration + Persistent Staging

**Rama:** `step05b/import-pipeline` · **HEAD inicial:** `5c37b83` (STEP 04 aprobado) · **HEAD final:** el commit que agrega este reporte (`docs: add STEP 05B report`), inmediatamente después de `47a3f45`.

Flujo entregado: `Excel → parser STEP 05A → ImportEnvelope v1 → staging persistente → validación → candidatos revisables → Domain Adapter → publicación controlada`. Se detiene antes de la publicación productiva automática.

## 1. Commits (14, sin reescritura de historia)

| Commit    | Mensaje                                              |
| --------- | ---------------------------------------------------- |
| `1fb8b18` | docs: add step05b integration assessment             |
| `d2139fa` | chore: integrate excel importer tooling              |
| `7823e9c` | feat: add import interchange contract                |
| `0405ec0` | feat: add import staging migrations                  |
| `ba5963f` | feat: persist import batches and candidates          |
| `9146a84` | feat: add domain import adapter                      |
| `085ddcb` | feat: add provenance bridge                          |
| `f62c693` | feat: add controlled candidate publication           |
| `3a9a03c` | test: add import pipeline integration coverage       |
| `90f5640` | feat: add import CLI and real-data dry run           |
| `472c185` | docs: add import pipeline documentation              |
| `a99d43f` | fix: never infer identity or defaults in the adapter |
| `47a3f45` | docs: refresh import dry-run report                  |
| (final)   | docs: add STEP 05B report                            |

## 2. Migraciones nuevas (0001–0011 intactas: `git diff 5c37b83` vacío)

| Migración                 | Contenido                                                                                                                                                 |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `0012_import_staging.sql` | `import_batch`, `import_record`, `import_candidate`, `import_candidate_source`, `import_issue`; append-only; guardas: histórico ↛ PRICE, TEST ↛ candidato |
| `0013_import_review.sql`  | `import_candidate_link`; transiciones de revisión; `PUBLISHED` exige enlace; enlace exige `APPROVED`; scope `IMPORT` en `change_event`                    |

**Tablas nuevas (6):** las cinco de staging + `import_candidate_link` (la adicional justificada: linaje staging → dominio). Sin `staging_product/service/price/option`, sin `variant`, `bundle`, `supplier`, `brand` (prueba de esquema).

## 3. Contratos nuevos

- `ImportEnvelope` v1 (`dtg.import-envelope`): Zod en `src/import/contract.ts`, JSON Schema generado en `contracts/import-envelope.v1.schema.json` (CI `import:schema --check`).
- Propuestas por tipo (`src/import/proposal.ts`), resoluciones humanas (`src/import/resolution.ts`), `AdapterContext`/`DomainOp`/`AdapterError` (`src/import/adapter.ts`).
- API programática: `stageEnvelope`, `validateBatch`, `approveCandidate`, `rejectCandidate`, `previewCandidate`, `publishCandidate`, `traceCandidate`, `traceEntity`.

## 4. Cambios al parser

**Ninguno.** `tools/excel-importer/parser` y `tests/test_parser.py` son copia byte a byte de STEP 05A (v0.1.0). La evidencia regenerada es idéntica a la entregada salvo finales de línea (05A se ejecutó en Windows, CRLF). La presentación se agregó en el módulo nuevo `interchange/`.

## 5. Pruebas

| Suite                                              | STEP 04 | Nuevas | Total   |
| -------------------------------------------------- | ------- | ------ | ------- |
| Unitarias (Vitest, sin BD)                         | 79      | 65     | **144** |
| Integración (Vitest, PostgreSQL 16)                | 24      | 24     | **48**  |
| Python STEP 05A (con workbooks)                    | 27      | —      | 27      |
| Python interchange (7 sin fuentes + 5 con fuentes) | —       | 12     | 12      |
| **Total**                                          | 130     | 101    | **231** |

Cobertura de lo pedido: validación Zod del bridge, envelope inválido rechazado, procedencia preservada; lote creado, mismo hash, re-run, segunda versión; status/kind/required desconocidos siguen sin resolver; históricos no publicables; precio vigente queda en staging y se publica como `DRAFT`; adaptador (item válido, inválido, tipo desconocido, opciones, decoración, composición, presentación, Money con moneda, sin redondeo silencioso); 131 → 14 sin pérdida, 23 excluidos, sin interpolación; procedencia en ambos sentidos; idempotencia y no-duplicación al reimportar.

## 6. Reconstrucción en máquina limpia

Clon nuevo de la rama → `pnpm install --frozen-lockfile` → lint → format:check → typecheck → 144 unitarias → `seed:check` → `import:schema --check` → `db:rebuild` (13 migraciones, 2 seeds, 48 integración) → `db:migrate` idempotente → `build` → `importer:test` sin fuentes (15) y con fuentes (39) → envelopes regenerados **idénticos byte a byte** → fixtures regenerados sin diff → dry run con reporte idéntico (salvo HEAD y tiempos) → hashes de los 5 Excel iguales antes y después. **Resultado: OK.** (PostgreSQL nativo; Docker no disponible en el entorno — P1-07 heredado.)

## 7. Dry run con datos reales (v1.2 RC, detalle en `import/IMPORT-DRY-RUN-REPORT.md`)

| Métrica                             | Valor                                                                                          |
| ----------------------------------- | ---------------------------------------------------------------------------------------------- |
| Workbooks staged                    | 5 (1 primario + 4 evidencia)                                                                   |
| Registros primarios (reales / TEST) | 1315 / 333                                                                                     |
| Candidatos                          | 413: 220 CATALOG_ITEM · 70 OPTION · 92 DECORATION · 5 COMPOSITION · 14 PRICE · 12 PRESENTATION |
| Precios                             | 131 observaciones → 14 definiciones (13 matrices / 130 breaks + 1 FIXED); 750 ausente          |
| Históricos                          | 23, sólo evidencia                                                                             |
| Clase                               | 202 PRODUCT · 15 SERVICE · 3 desconocida (no forzada)                                          |
| Estado comercial desconocido        | 197 (queda `null`; 16 ACTIVE y 7 CANDIDATE explícitos)                                         |
| Issues                              | 764 distintos: 761 WARNING · 0 ERROR · 3 INFO                                                  |
| Revisión                            | 0 VALID · 413 WARNING · 0 BLOCKED                                                              |
| Publicables en 05B                  | **0** (REAL deshabilitado; todo requiere aprobación)                                           |
| Adaptables tal cual                 | 5, todos sólo concilian con filas ya sembradas                                                 |
| Posibles duplicados                 | 2 pares (MIG2-O-062/063, MIGF-O-018/028) + 3 relaciones X-Banner                               |
| Idempotencia                        | re-stage de los 5 envelopes → `ALREADY_STAGED`                                                 |
| Dominio / Excel                     | sin cambios / hashes idénticos                                                                 |

## 8. Hallazgos

**P0:** ninguno.

**P1 abiertos**

| ID    | Tema                                                                                                                                                                                               |
| ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P1-01 | Estados del slice provisionales; 197 estados desconocidos en v1.2 requieren decisión (Q-03)                                                                                                        |
| P1-02 | Redondeo MXN (`ROUND_HALF_UP`, 2 decimales) e IVA siguen provisionales; la importación no calcula México                                                                                           |
| P1-03 | Imanes: `maxQuantity` del precio FIXED debe decidirlo el dueño (el adaptador lo exige explícito)                                                                                                   |
| P1-05 | Alcance de recargos por talla (sin cambio)                                                                                                                                                         |
| P1-06 | Quién autoriza precios (DRAFT → AUTHORIZED), autenticación CRM, RLS                                                                                                                                |
| P1-07 | Push a GitHub + ejecución de CI y `db:start` con Docker sin verificar en este entorno                                                                                                              |
| P1-08 | Revisión masiva pendiente: política de decoración de 220 items, 88 asociaciones de método (decoración vs producción inherente, Q-12), semántica de 70 opciones (Q-11), locale de 12 presentaciones |
| P1-09 | Habilitar publicación de datos `REAL` (`PUBLICATION_ENABLED_FOR`) es decisión explícita del dueño para STEP 06+                                                                                    |
| P1-10 | Los Excel no están en Git: las pruebas con fuentes reales corren sólo con `DTG_SOURCES`; definir almacenamiento privado para CI                                                                    |

**P2:** composición por modalidad material/instalación (MIG2-O-002) sin servicio destino (Q-13); 3 items con clase vacía (MIG1-O-014, MIG1-O-019, OWN-MT-O-046); 2 pares probables de duplicado; categorías no se importan (220 `IMPORT_UNMAPPED_CATEGORY`, taxonomía P2-13); 37 fórmulas sin evaluar; versionado de precios (`supersedes_id`) desde importación no implementado (se obliga a enlazar); `sort` de opción por defecto 0; envelope primario de 33 MB (suficiente hoy; streaming si crece).

## 9. Decisiones pendientes del dueño

1. Estado comercial de los items (al menos del vertical slice) y política de decoración por item.
2. Qué asociaciones de método son decoración elegible (DTF, bordado, serigrafía, HTV) y cuáles producción inherente (UV DTF, sublimación, impresión…).
3. Semántica y obligatoriedad de cada opción (`Obligatoria` vacía en las 70).
4. Cantidad del precio fijo de imanes; redondeo e IVA de México; quién autoriza precios en PE.
5. Cuándo habilitar la publicación de datos REAL y con qué rol.

## 10. Qué debe hacer STEP 06 (sólo con autorización explícita)

Admin MVP sobre la API ya existente: listas de lotes/candidatos con filtros por tipo/estado/campos sin resolver, formulario de resolución por tipo (esquemas Zod de `resolution.ts`), vista previa del adaptador (`previewCandidate`), aprobación/rechazo, publicación uno por uno, visor de procedencia (`traceEntity`/`traceCandidate`), autenticación y roles; luego habilitar `REAL` y el flujo DRAFT → AUTHORIZED con autorizador.

## 11. Autoauditoría

| Riesgo                                 | Resultado                                                                                                                  |
| -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Duplicar conceptos staging/dominio     | No: staging guarda hipótesis JSONB; las formas finales sólo existen en el dominio STEP 04                                  |
| Reglas de negocio ocultas en el parser | No: parser intacto; interchange sólo serializa y une presentaciones de forma literal                                       |
| Defaults silenciosos                   | Corregidos en `a99d43f` (material del cliente); estado, clase, obligatoria, política, vigencia y cantidad FIXED explícitos |
| Históricos entrando a pricing          | Imposible: Zod, trigger de BD y adaptador; publicados como `HISTORICAL_PRICE_EVIDENCE`                                     |
| `null → false`                         | No: `required: null` persiste; `isRequired` se exige en la aprobación                                                      |
| Nombres de Excel como identidad        | No: linaje por `LEGACY_ID`; presentaciones con igual nombre exigen `LINK_EXISTING` explícito                               |
| Procedencia faltante                   | No: celdas en staging, `EXCEL_ROW`/`LEGACY_ID`/`HISTORICAL_PRICE_EVIDENCE` en dominio, enlace en ambos sentidos            |
| Edición retroactiva de migraciones     | No: 0001–0011 sin diff; cambios en 0012/0013                                                                               |
| Dependencias innecesarias              | Ninguna nueva en `package.json`; Python/openpyxl ya requeridos por 05A                                                     |

## 12. Matriz de requisitos

| Requisito                                                                   | Estado | Evidencia                                                                   |
| --------------------------------------------------------------------------- | ------ | --------------------------------------------------------------------------- |
| Inspección previa + assessment antes de cambiar código                      | ✅     | `docs/import/STEP_05B_INTEGRATION_ASSESSMENT.md` (`1fb8b18`, primer commit) |
| Rama nueva desde HEAD aprobado, commits pequeños                            | ✅     | 14 commits sobre `5c37b83`                                                  |
| Parser no reescrito; tool Python en el repo                                 | ✅     | `tools/excel-importer/parser` idéntico a 05A                                |
| Contrato neutral versionado + Zod (+ JSON Schema)                           | ✅     | `src/import/contract.ts`, `contracts/…schema.json`, `import-contract.test`  |
| Persistir cada corrida (archivo, hash, versión, conteos…)                   | ✅     | `import_batch`; `import-staging.test`                                       |
| Staging genérico mínimo                                                     | ✅     | 6 tablas; prueba de esquema                                                 |
| Tipos de candidato (6) incl. presentación                                   | ✅     | enum `import_candidate_kind`; interchange `presentation.py`                 |
| Estado desconocido ≠ CANDIDATE; sin quinto estado                           | ✅     | 197 null; pruebas unitarias y de BD                                         |
| `required null` ≠ false                                                     | ✅     | 70/70 null; `isRequired` exigido                                            |
| PRODUCT/SERVICE sin forzar UNKNOWN; sin Bundle                              | ✅     | 202/15/3; BUNDLE bloquea                                                    |
| Sin Variant; señal `VARIANT_MATERIALIZATION_CANDIDATE`                      | ✅     | Se conserva el código del parser; 0 casos reales (sólo filas TEST)          |
| Código público sólo al publicar                                             | ✅     | secuencia de BD en `CREATE_CATALOG_ITEM`; prueba `DTG-000xx > 16`           |
| Procedencia en dos capas, ambos sentidos                                    | ✅     | `provenance.ts`; prueba celda 120 ↔ definición                              |
| Históricos nunca activos; vigentes vía staging                              | ✅     | trigger + adaptador; precios `DRAFT`                                        |
| 14 definiciones / 131 observaciones; sin interpolar                         | ✅     | `groupPrices`; prueba con extracto real                                     |
| México sin recalcular; redondeo/IVA provisionales                           | ✅     | MXN bloqueado; decisión I13                                                 |
| Decoración ≠ productos DTF; blank = sin selección                           | ✅     | pruebas DTF Transfer / política OPTIONAL                                    |
| Composición por relaciones                                                  | ✅     | X-Banner → estructura + gráfica                                             |
| Presentación como evidencia no auto-publicada                               | ✅     | locale/isDefault requeridos                                                 |
| Duplicados sin fusión                                                       | ✅     | `IMPORT_DUPLICATE_REVIEW`, `autoMerge=false`                                |
| Estado de revisión separado                                                 | ✅     | `import_review_status` disjunto                                             |
| Domain Adapter explícito con errores estructurados                          | ✅     | `adapter.ts`; 28 pruebas unitarias                                          |
| approve/publish programáticos; imposibles si bloqueado…                     | ✅     | `review.ts`, `publish.ts`; guardas de BD                                    |
| Idempotencia + reimport v1/v2 con historia                                  | ✅     | `REIMPORTS.md`; pruebas                                                     |
| Migraciones nuevas, sin editar aplicadas                                    | ✅     | 0012/0013                                                                   |
| Pruebas previas intactas + nuevas                                           | ✅     | 79/24/27 siguen pasando; 231 en total                                       |
| Dry run real + reporte                                                      | ✅     | `docs/import/IMPORT-DRY-RUN-REPORT.md`                                      |
| No publicar los ~220; sólo subset DEV/TEST                                  | ✅     | `PUBLICATION_ENABLED_FOR = ['FIXTURE']`                                     |
| Excel intacto · sin cambios manuales de BD · CRM y Supabase remoto intactos | ✅     | hashes; todo vía migraciones/API; sin código de CRM ni remoto               |
| Documentación                                                               | ✅     | `docs/import/*`, ADR-0014/0015, README, DATABASE, DECISIONS                 |

PASS WITH P1 OPEN ITEMS — STEP 05B COMPLETE
