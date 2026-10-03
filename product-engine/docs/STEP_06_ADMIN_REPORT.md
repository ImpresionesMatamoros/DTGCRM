# STEP 06 — Admin MVP / Review Console · Reporte final

**Rama:** `step06/admin-mvp` (desde `step05b/import-pipeline`)
**HEAD inicial:** `fc0df10` · **HEAD final:** ver `git log -1` (el commit de este reporte)
**Fecha:** 2026-09-30

## 1. Resumen

Martín puede abrir `/admin`, ver qué falta decidir en los 413 candidatos reales y resolverlo campo por campo o en masa. Cada campo muestra qué decía el Excel, qué decidió una persona y qué sigue sin resolver. Antes de aprobar se ve la vista previa del Domain Adapter real. Todo cambio queda auditado con actor y motivo.

Los candidatos REAL llegan como máximo a APPROVED: la publicación REAL sigue deshabilitada. Además hay un catálogo básico (buscar, ver, crear mínimo, editar campos seguros, historial) y un visor de precios con la derivación México calculada por el dominio y la evidencia histórica separada.

## 2. Commits (17)

```
92e22db docs: add step06 admin assessment
ec592b8 feat: add admin review migration and category resolution
f8a81eb feat: add resolution workflow and review audit services
fa740e9 feat: add bulk candidate resolution
39018a0 feat: add import, catalog and pricing admin services
06b579b test: add admin review coverage
12b0ad7 feat: add admin shell and navigation
e46e12a feat: add import batches view
bb2d50f feat: add import review inbox and candidate review detail
7f5b0eb feat: add catalog browser and item editor
cfca80c feat: add pricing viewer
2775131 feat: filter the inbox by any open resolution field
5798c08 test: add playwright acceptance flows
fd07947 refactor: keep admin pages free of raw SQL
c3fe3f0 test: add admin boundary and category resolution checks
d830f92 fix: say that approval uses the saved resolution
80bfd6c docs: add admin operations guide
(+ este reporte)
```

## 3. Migraciones

Una nueva, `0014_admin_review.sql` (0001–0013 intactas):

- `change_event.context` y `record_change()` redefinida: `changed_by` = actor de la aplicación (`dtg.actor`), sin cambiar su contrato.
- `import_candidate.open_fields`: campos abiertos tras el borrador, calculados en TypeScript.
- `review_event` y `review_bulk_operation`, append-only.
- Vista `v_review_candidate` y tres índices de expresión.

## 4. Rutas

`/admin` · `/admin/imports` · `/admin/imports/[id]` · `/admin/review` · `/admin/review/[id]` · `/admin/review/audit` · `/admin/catalog` · `/admin/catalog/new` · `/admin/catalog/[id]` · `/admin/pricing` · `/admin/pricing/[id]` · `/admin/pricing/historical`. Además, `/` enlaza al Admin.

## 5. Componentes y servicios principales

| Capa                       | Piezas                                                                                                                                                                                                                                                                             |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Puro (`src/review`)        | `FIELD_DEFS`, `fieldViews`, `openFields`, `applyDraftPatch`, `planBulk`, `entriesToWrite`, `explainIssue`, etiquetas                                                                                                                                                               |
| Frontera (`src/admin`)     | `permissions.ts` (`authorize`, capacidades), `handlers.ts` (saveDraft, approve, reject, withdraw, publishFixture, bulkPreview, bulkApply, createItem, updateItem, simulate), `filters.ts`                                                                                          |
| Servicios (`src/db/admin`) | `tx.ts` (transacción con actor), `review.ts` (inbox, facetas, detalle, preview, borrador, aprobar, rechazar, retirar, publicar FIXTURE, eventos), `bulk.ts`, `imports.ts`, `catalog.ts`, `pricing.ts` (matrices, México con `resolvePrice`, simulador, históricos), `dashboard.ts` |
| Dominio / importación      | `parseDraftResolution` (esquema parcial); `categoryKey` en la resolución de CATALOG_ITEM; op `ASSIGN_CATEGORY` en adaptador y ejecutor                                                                                                                                             |
| UI (`src/app/admin`)       | Layout + CSS propio, `ReviewTable` (selección y masivos), `ResolutionPanel` (controles por tipo, destino, definición y valores de opción), `CandidateActions`, `CreateItemForm`, `EditItemForm`, `PriceSimulator`, `ValueInput`                                                    |

## 6. Pruebas

|                    | Antes (05B) | Después                                                                                   |
| ------------------ | ----------- | ----------------------------------------------------------------------------------------- |
| Unitarias (Vitest) | 144         | **164** (+ `review.test.ts`, `admin-boundaries.test.ts`)                                  |
| BD (Vitest)        | 48          | **74** (+ `admin-review`, `admin-bulk`, `admin-catalog`, `admin-pricing`, `admin-safety`) |
| Python             | 39          | **39**                                                                                    |
| E2E (Playwright)   | —           | **6** (escenarios A–F)                                                                    |
| **Total**          | **231**     | **283**                                                                                   |

Todas en verde en un clon limpio (§12). El dry run real produce el mismo reporte que en 05B (comparado sin tiempos ni HEAD): el adaptador no cambió su comportamiento sobre los 413 candidatos.

Cobertura pedida en §35:

- **Integración UI/dominio:** carga del inbox, filtros, lo no resuelto sigue sin resolver, la resolución persiste, resolución inválida rechazada, preview con el adaptador real.
- **Masivos:** compatibles se actualizan, valores distintos producen aviso y no se sobrescriben, bloqueados y aprobados se omiten, vista previa vieja rechazada, eventos de auditoría y grupos de decisión.
- **Catálogo:** búsqueda, alta mínima, edición, identidad inmutable.
- **Precios:** definiciones vigentes, históricos separados, matriz exacta, derivación México igual a `resolvePrice` y a USD × 0.70 × 16.50 HALF_UP.
- **Seguridad:** REAL sigue deshabilitado, FIXTURE funciona, no hay bypass desde el cliente, un histórico nunca se vuelve precio.

## 7. Escenarios de aceptación (§41)

Todos automatizados en `tests/e2e/admin.spec.ts` sobre el staging real y verdes (re-ejecutables):

| Escenario | Evidencia                                                                                                                                                                                  |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| A         | Candidato real con `status` y `decorationPolicy` sin resolver (nada preseleccionado) → se resuelven → preview del adaptador → aprobado → botón de publicación REAL deshabilitado con razón |
| B         | Opción con `required = null` → "sin resolver" sin ningún valor marcado → `false` → guardado, recargado y auditado                                                                          |
| C         | Candidato → registro → workbook / hoja / fila / celda con valor original, normalizado, fórmula y caché                                                                                     |
| D         | 3 candidatos → campo → vista previa con conteos → confirmar → operación visible en la auditoría con actor                                                                                  |
| E         | Evidencia histórica separada, etiquetada "Not used for current pricing", sin ningún botón                                                                                                  |
| F         | Alta mínima (rechazada sin estado/política) → buscar → abrir → editar descripción → historial con actor y contexto                                                                         |

Capturas en `docs/admin/screenshots/`.

## 8. Requisitos

| Requisito                                       | Estado | Evidencia                                                                                |
| ----------------------------------------------- | ------ | ---------------------------------------------------------------------------------------- |
| §1 Rama + assessment antes de código            | Cumple | `92e22db` es el primer commit; `docs/admin/STEP_06_ADMIN_ASSESSMENT.md`                  |
| §2 Todo dentro del mismo repo/BD/dominio        | Cumple | Sin apps, bases ni modelos nuevos                                                        |
| §3 Cuatro superficies                           | Cumple | `/admin/imports`, `/review`, `/catalog`, `/pricing` (+ `/admin`)                         |
| §4 Import batches                               | Cumple | Lista y detalle; cifras sólo del staging                                                 |
| §5 Review inbox                                 | Cumple | Búsqueda, paginación en servidor, 14 filtros, orden, selección (página o todo el filtro) |
| §6 Review row                                   | Cumple | Nombre, tipo, fuente, estado, issues, campos resueltos y sin resolver                    |
| §7 Detalle Source/Normalized/Resolution/Preview | Cumple | `/admin/review/[id]`                                                                     |
| §8 Procedencia                                  | Cumple | Todas las celdas de todos los registros fuente                                           |
| §9 Issues                                       | Cumple | Código, severidad, explicación legible, campo afectado, origen                           |
| §10 Panel de resolución                         | Cumple | Sólo los campos pertinentes por tipo                                                     |
| §11 Sin resolver automático                     | Cumple | Pruebas `admin-review`, `review.test`, E2E B                                             |
| §12 Domain preview real                         | Cumple | `previewCandidate`; errores reales del adaptador                                         |
| §13 Approve ≠ Publish; REAL deshabilitado       | Cumple | `PUBLICATION_ENABLED_FOR` intacto; pruebas de seguridad                                  |
| §14–15 Masivos seguros                          | Cumple | `admin-bulk`, `BULK-OPERATIONS.md`                                                       |
| §16 Auditoría                                   | Cumple | `review_event` con candidato, campo, antes, después, fecha, actor, motivo                |
| §17 Grupos de decisión (preparado)              | Cumple | `decisionGroup` → `DECISION_GROUP`; `?ids=` en el inbox                                  |
| §18 Catálogo                                    | Cumple | Buscar, filtrar, detalle completo, edición segura                                        |
| §19 Crear item                                  | Cumple | Alta mínima; sin defaults silenciosos                                                    |
| §20 Editar                                      | Cumple | Identidad y kind inmutables; auditoría con actor                                         |
| §21 Categoría                                   | Cumple | Categoría del Excel como evidencia + resolución explícita; selector en catálogo          |
| §22 Opciones                                    | Cumple | Valores, obligatoria, estado sin resolver en staging; sin Variant                        |
| §23 Decoración                                  | Cumple | Métodos, capacidades, política; capacidad ≠ proceso                                      |
| §24 Composición                                 | Cumple | Padre/hijo/cantidad/INCLUDED-OPTIONAL; sin editor                                        |
| §25 Pricing MVP                                 | Cumple | Definiciones, mercado, modelo, breaks, condiciones, estado, procedencia, México          |
| §26 Autorización de precios                     | Cumple | Botón no operativo con razón; sin action; sin RBAC inventado                             |
| §27 México                                      | Cumple | USA base, política, factor, FX, derivado, HALF_UP_2 provisional, IVA sin resolver        |
| §28 Históricos                                  | Cumple | Separados, etiquetados, sin acciones                                                     |
| §29–30 Diseño y prioridades UX                  | Cumple | App interna densa; CSS propio; sin dependencias de UI                                    |
| §31 Dashboard                                   | Cumple | 8 métricas reales, cada una con enlace                                                   |
| §32 Auth mínima preparada                       | Cumple | Actor local + capacidades; roles futuros sin reescribir mutaciones                       |
| §33 Validación en servidor                      | Cumple | Zod estricto + estado + dominio + triggers                                               |
| §34 Sin lógica de dominio en la UI              | Cumple | `admin-boundaries.test.ts`                                                               |
| §35 Pruebas                                     | Cumple | §6                                                                                       |
| §36 BD                                          | Cumple | Sólo 0014; dos tablas, una vista                                                         |
| §37 Rendimiento                                 | Cumple | Filtros/paginación en servidor; la vista completa sobre 413 candidatos tarda ~0.1 s      |
| §38 STEP 05C                                    | N/A    | No llegó el paquete durante el paso; el enganche está listo (§17)                        |
| §39 Fuera de alcance                            | Cumple | Nada de lo listado se implementó                                                         |
| §40 Commits pequeños                            | Cumple | 17 commits                                                                               |
| §42 Reconstrucción limpia                       | Cumple | §12                                                                                      |
| §43 Documentación                               | Cumple | `docs/admin/*`, ADR-0016, este reporte                                                   |
| §45 Auto-audit                                  | Cumple | §11                                                                                      |

## 9. Decisiones

Registradas en `docs/admin/STEP_06_ADMIN_ASSESSMENT.md` (A1–A17), `docs/DECISIONS.md` (STEP 06) y ADR-0016. Las más importantes:

- Borrador en `resolution`, con esquema parcial.
- Auditoría por campo más actor en `change_event`.
- Categoría explícita y no bloqueante.
- Alta de item con estado y política elegidos explícitamente.
- Sin action de autorización de precios.

## 10. Hallazgos, P0 / P1 / P2

**P0:** ninguno.

**P1 (decisiones del dueño o de infraestructura; no bloquean usar la consola):**

| #                                 | Tema                                                                                                                                                                                                                         |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P1-06                             | Quién autoriza precios y autenticación/RBAC. El actor local no es una identidad verificada: **el Admin no debe exponerse fuera de la máquina local** hasta resolverlo                                                        |
| P1-09                             | Habilitar la publicación REAL (hoy sólo FIXTURE)                                                                                                                                                                             |
| P1-08                             | Revisión masiva real: estado de los 197 items, política de decoración de los 220, qué es decoración y qué proceso en las 88 asociaciones, las 70 opciones, los locales de las 12 presentaciones. Las herramientas ya existen |
| P1-02                             | Redondeo MXN (HALF_UP_2 provisional) e IVA                                                                                                                                                                                   |
| P1-01, P1-03, P1-05, P1-07, P1-10 | Sin cambios respecto a 05B. P1-10 implica además que el E2E no corre en CI                                                                                                                                                   |

**P2:**

- Las pruebas de BD de STEP 04/05B (`import-publish`, `import-staging`, `seed-and-snapshot`) asumen una base limpia. Fallan con el staging real cargado o después del E2E. Es anterior a este paso y está documentado (`pnpm db:rebuild` antes de `test:db`). Las pruebas nuevas del Admin son robustas a ese estado.
- Opción: al **crear** un valor nuevo de tipo DIMENSIONS/QUANTITY/LENGTH, la UI no pide la especificación (`w`/`h` o `value`). El adaptador lo reporta en la vista previa. Los valores existentes y los ENUM sí funcionan.
- El destino `LINK_EXISTING` para PRICE y PRESENTATION se indica con el UUID a mano (para CATALOG_ITEM se ofrecen los items con el mismo LEGACY_ID).
- "Seleccionar todos los del filtro" sólo cuando son ≤ 2000 (mismo tope por operación masiva).
- En la tabla de auditoría, "ausente" y `null` explícito se ven igual (∅). En la base se distinguen (SQL NULL vs JSON null).
- Retirar una aprobación re-valida el lote completo (`validateBatch`), que es correcto pero más trabajo del necesario.
- No se editan desde el catálogo opciones, decoración, composición ni presentaciones (fuera del MVP).

## 11. Auto-audit (§45)

| Revisión                          | Resultado                                                                                                |
| --------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Lógica de negocio duplicada en UI | Ninguna; prueba estática; las consultas SQL de páginas se movieron a servicios (`fd07947`)               |
| Defaults silenciosos              | Ninguno encontrado (búsqueda de `?? false`, estados por defecto); alta de item corregida desde el diseño |
| Publicación REAL accidental       | Imposible por tres capas; probado                                                                        |
| Filtración de históricos          | Ninguna; secciones separadas sin acciones                                                                |
| Mutaciones desde el cliente       | Sólo Server Actions con handlers validados                                                               |
| Procedencia faltante              | Cada candidato muestra todas sus celdas; cada item y definición, sus `source_reference` y candidatos     |
| Masivos destructivos              | No hay borrado ni sobrescritura sin confirmación; append-only                                            |
| Identificadores editables         | No                                                                                                       |
| Dependencias innecesarias         | Sólo `@playwright/test` (devDependency, para §35)                                                        |
| Abstracciones prematuras de UI    | Un único `ValueInput` compartido; sin sistema de componentes                                             |

Corregido durante el auto-audit: SQL directo en dos páginas, la etiqueta "Sin asignar" en campos que traen valor del Excel (ahora dice "Usar el del Excel (…)"), celdas vacías que ocultaban las útiles en la procedencia, y el aviso de que aprobar usa la resolución guardada.

## 12. Reconstrucción limpia (§42)

En un clon nuevo de la rama:

1. `pnpm install --frozen-lockfile`
2. `pnpm db:rebuild`: 14 migraciones, 2 seeds, 74/74 pruebas de BD.
3. `pnpm db:migrate`: al día.
4. `seed:check` e `import:schema --check`: sin drift.
5. `format:check`: OK.
6. `pnpm verify`: lint, typecheck, 164/164 unitarias y build.
7. `importer:test`: 39/39.
8. `importer:envelopes` + `import:dry-run`: 413 candidatos, mismo reporte que 05B.
9. `pnpm start`: todas las rutas del Admin responden 200.
10. Playwright: 6/6.

## 13. Readiness para STEP 07

Listo para empezar cuando el dueño lo autorice.

- La consola permite ya hacer la revisión real (P1-08) sin tocar código.
- Lo que falta para producción son decisiones del dueño: quién autoriza precios y la autenticación (P1-06), la publicación REAL (P1-09) y el redondeo/IVA de México (P1-02).
- Si llega el paquete STEP 05C, se integra por `?ids=` y `decisionGroup` sin rehacer la arquitectura (§17).

PASS WITH P1 OPEN ITEMS — STEP 06 ADMIN MVP COMPLETE
