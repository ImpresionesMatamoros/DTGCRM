# STEP 08 — Data Quality & Controlled Bulk Operations · Informe final

## 1. HEAD inicial y final

- Inicial: `9edf65f` (STEP 07, "PASS WITH P1 OPEN ITEMS"), rama nueva `step08/data-quality-bulk-ops`.
- Final: el commit que contiene este informe (`git log -1` en la rama).

## 2. Commits

1. `193b0ca` docs: assess step08 data quality scope
2. `15bbdf0` feat: deterministic data quality rules, readiness, decision answers, category mapping and strict bulk (incluye migración 0016 y pruebas unitarias/DB)
3. `a6d238f` feat: quality dashboard, issue queue, readiness, gate, categories, duplicates and decision answers UI
4. `ff0197e` test: data quality e2e scenarios A–G
5. `82686a1` docs: step08 dry run, rules catalogue, gate, STEP 09 input, ADR-0018 and report generator
6. (este) docs: step08 final report

## 3. Migraciones nuevas

Sólo `0016_data_quality.sql` (después de 0015; no se editó ninguna migración anterior): `owner_decision_answer`, `category_mapping`, `quality_mark` (append-only, auditadas) y `review_bulk_operation.decision_answer_id`. Los hallazgos no se guardan.

## 4. Reglas de calidad

52 reglas deterministas con códigos estables (`DQ-CATALOG`, `OPTION`, `DECOR`, `COMP`, `PRES`, `PRICE`, `PROV`, `IMPORT`), severidad BLOCKER/WARNING/INFO, remediación BULK_RESOLVABLE / MANUAL_REVIEW / OWNER_DECISION_REQUIRED / SOURCE_FIX. Catálogo generado desde el código: `docs/step08/DATA_QUALITY_RULES.md`. Las reglas de precio reutilizan el resolver de STEP 07; D-008/D-010/D-011/D-016/D-022 aparecen como `OWNER_DECISION_REQUIRED`, no como error técnico. Los 23 precios históricos son sólo evidencia.

## 5. Hallazgos reales (413 candidatos, workbooks reales)

1281 hallazgos: 1053 BLOCKER, 224 WARNING, 4 INFO. 691 esperan una decisión del dueño, 545 son resolubles en masa, 45 son sólo manuales, 0 de corrección en la fuente. 8 de 413 candidatos están resueltos. Detalle por tipo, área, regla y decisión: `docs/step08/DATA_QUALITY_DRY_RUN.md`; informe máquina: `data-quality-report.json` y `data-quality-findings.csv`.

Antes/después (demostración con una respuesta **hipotética** a D-001 en una transacción revertida, base verificada idéntica después): estados de catálogo sin resolver **197 → 0**; bloqueantes 1053 → 856; el resto de bloqueos (unidad de venta, opciones, decoración, precios, decisiones) sigue visible.

## 6. Operaciones masivas añadidas

Extensión (no reconstrucción) del flujo de STEP 06: modo `strict` (INCOMPATIBLE_SELECTION; nunca `Option.required` en artículos), resumen de vista previa con NOT_APPLICABLE/BLOCKED, remediación por regla (vista previa → aplicar, vista previa obsoleta rechazada, sin sobrescritura sin confirmar), mapeo de categorías con vista previa de impacto y registro, `DECISION_GROUP` con respuesta registrada obligatoria, marcas de duplicados DISTINCT/REVIEWED (sin fusión).

## 7. Decisiones integradas

Las 22 decisiones muestran ABIERTA/RESPONDIDA. Registrar la respuesta exige el rol `decision.record` (nadie lo tiene por defecto; `DTG_DECISION_RECORDERS`), con actor, fecha, notas y cadena de revisiones. Nunca se responde automáticamente; en el staging real ninguna está respondida. Aplicables en masa: D-001, D-002, D-003, D-013. D-022/IVA y D-016 siguen abiertas; HALF_UP_2 sigue "PROVISIONAL TECHNICAL BEHAVIOR".

## 8. Readiness de Commercial Print

21 de 21 artículos en staging; **0 podrían migrar**; 0 con revisión/dominio/precios listos; 17 QUOTE_ONLY; 21 bloqueados por decisiones abiertas (D-001 y D-016 en los 21); 18 sin unidad de venta, 21 sin estado y 21 sin categoría; 5 con bloqueos de opciones; 2 con presentaciones sin resolver; procedencia íntegra. Ver `COMMERCIAL_PRINT_MIGRATION_GATE.md` y `STEP_09_COMMERCIAL_PRINT_INPUT.md`.

## 9. Pruebas

| Suite               | Base (STEP 07) | Ahora                       |
| ------------------- | -------------- | --------------------------- |
| Unitarias           | 174            | 218                         |
| Base de datos       | 111            | 122                         |
| Importador (Python) | 39             | 39                          |
| Playwright          | 12             | 19 (12 + 7 de STEP 08: A–G) |

Además: eslint, prettier, `tsc --noEmit` y `next build` limpios.

## 10. Reconstrucción limpia

Clon nuevo del repositorio → `pnpm install --frozen-lockfile` → `db:rebuild` (migraciones + seed + 122 pruebas DB) → `seed:check` → unitarias → importador → staging real (413 candidatos) → Playwright (19/19) → build. Re-ejecutado `quality:report` sobre esa base limpia: mismas claves de hallazgo que las del informe. Los 5 workbooks se verificaron por sha256 contra el zip original (sin cambios).

## 11. P0

Ninguno.

## 12. P1 abiertos

1. Nada está READY con datos reales: depende de decisiones del dueño sin responder (D-001, D-002, D-016, D-022…) y de la barrera REAL (cerrada a propósito).
2. `decorationPolicy` está abierta en los 220 artículos y ninguna decisión la cubre: la herramienta la ofrece en masa, pero el valor es una decisión de negocio que debe tomar una persona.
3. Heredados de STEP 07: D-016 (quién autoriza precios) y D-022/IVA México siguen abiertos.

## 13. P2

- DQ-CATALOG-003 y DQ-PRICE-003 miran la misma unidad de venta desde lados distintos (documentado).
- Los hallazgos no se guardan: no hay tendencia histórica, sólo comparación entre corridas por clave estable.
- Sólo 4 decisiones tienen forma aplicable en masa; las demás se registran en palabras y se resuelven a mano.
- La remediación por regla actúa sobre todos sus hallazgos resolubles (el filtro por categoría existe en el servidor, no en la pantalla).
- El E2E escribe en la base local (rebuild + restage después).

## 14. Preparación exacta para STEP 09 (no iniciar sin autorización)

1. Que el dueño responda D-001, D-002 (y D-003, D-009 para categoría) y se registren con la herramienta.
2. Mapear la categoría de origen de los 21 artículos y resolver unidad de venta/estado.
3. Resolver opciones y presentaciones de los 5 + 2 artículos señalados.
4. Resolver D-008/D-010/D-011/D-016 antes de hablar de precios; México (D-022) fuera de alcance.
5. Sólo entonces una decisión explícita para levantar la barrera de publicación (no incluida aquí).

## 15. Requisito | Estado | Evidencia

| Requisito                                                                                | Estado | Evidencia                                                                                               |
| ---------------------------------------------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------- |
| Motor de reglas determinista, códigos estables                                           | OK     | `src/quality/*`, `DATA_QUALITY_RULES.md`, pruebas unitarias                                             |
| Severidades BLOCKER/WARNING/INFO                                                         | OK     | `types.ts`, dashboard                                                                                   |
| Reglas items/opciones/decoración/composición/presentaciones                              | OK     | 52 reglas                                                                                               |
| Reglas de precio + decisiones como OWNER_DECISION_REQUIRED                               | OK     | DQ-PRICE-010…014                                                                                        |
| `/admin/data-quality` con números clicables                                              | OK     | E2E A, B                                                                                                |
| Preparación por dimensiones, sin puntaje 0–100                                           | OK     | readiness page, auditoría                                                                               |
| Razones por estado                                                                       | OK     | `ReadinessReason`, `/readiness`                                                                         |
| Inventario de reglas                                                                     | OK     | `/inventory`                                                                                            |
| Masivos sólo donde hacen falta, compatibles por campo                                    | OK     | strict, `quality-bulk.test.ts`                                                                          |
| Vista previa SAME/DIFFERENT + NOT_APPLICABLE/BLOCKED                                     | OK     | `bulk.ts`, pruebas                                                                                      |
| Sin sobrescritura silenciosa; DECISION_GROUP con origen y respuesta                      | OK     | `admin-bulk.test.ts`                                                                                    |
| Cola de decisiones como herramienta, sin responder                                       | OK     | `/admin/decisions`, E2E E                                                                               |
| Registro mínimo auditable de respuestas                                                  | OK     | `owner_decision_answer`, DB tests                                                                       |
| Nunca autoresponder                                                                      | OK     | rol `decision.record`; sin acción automática                                                            |
| Cola `/issues` con filtros                                                               | OK     | E2E B, C                                                                                                |
| Mapeo de categorías con vista previa, sin auto-mapeo                                     | OK     | E2E F, DB tests                                                                                         |
| Unidad de venta sólo con unidades existentes                                             | OK     | control de FIELD_DEFS, sin PAIR/PIECE inventados                                                        |
| Duplicados lado a lado, sin fusión                                                       | OK     | `/duplicates`, `quality_mark`                                                                           |
| Procedencia                                                                              | OK     | DQ-PROV-001…003                                                                                         |
| Vista Commercial Print (21)                                                              | OK     | E2E G                                                                                                   |
| `COMMERCIAL_PRINT_MIGRATION_GATE.md`                                                     | OK     | docs/step08                                                                                             |
| Export JSON/CSV con hallazgos                                                            | OK     | `/export`, `data-quality-report.json`                                                                   |
| Antes/después                                                                            | OK     | 197 → 0, otros bloqueos visibles                                                                        |
| Migración nueva tras 0015                                                                | OK     | `0016_data_quality.sql`                                                                                 |
| Cálculo bajo demanda, sin jobs                                                           | OK     | ADR-0018                                                                                                |
| Integrado en la navegación                                                               | OK     | "Calidad" en el menú                                                                                    |
| REAL deshabilitada; sin autorizar precios; históricos = evidencia; México/IVA sin cerrar | OK     | `PUBLICATION_ENABLED_FOR=['FIXTURE']`, reglas, E2E                                                      |
| Pruebas base + nuevas; E2E A–G                                                           | OK     | sección 9                                                                                               |
| Workbooks intactos                                                                       | OK     | sha256 verificados antes y después                                                                      |
| Dry run, entrada STEP 09, reporte                                                        | OK     | docs/step08                                                                                             |
| Auditoría §42                                                                            | OK     | sin puntajes, sin defaults silenciosos, sin merge, sin acciones "real", sin lógica de dominio duplicada |
| No iniciar STEP 09                                                                       | OK     | detenido aquí                                                                                           |

PASS WITH P1 OPEN ITEMS
