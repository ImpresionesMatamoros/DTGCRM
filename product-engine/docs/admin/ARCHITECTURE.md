# Admin (STEP 06) — Arquitectura

La consola de revisión y el admin básico viven **dentro** de `dtg-product-engine`. No hay repo nuevo, ni app paralela, ni otra base, ni otro modelo de dominio.

## Capas

```
Navegador ── componentes cliente (sólo muestran y envían)
   │  Server Actions (POST)
   ▼
src/app/admin/actions.ts ── delgadas: actor local + handler + refresco
   ▼
src/admin/handlers.ts ── Zod (entrada) + permisos (capacidad) + transacción auditada
   ▼
src/db/admin/*.ts ── servicios: estado del candidato, dominio, auditoría
   │   reutilizan STEP 05B: approveCandidate, rejectCandidate, previewCandidate,
   │   publishCandidate, traceCandidate, validateBatch
   ▼
src/review (puro) · src/import (puro) · src/pricing (puro) · src/domain (puro)
   ▼
PostgreSQL (triggers = última defensa: identidad, transiciones, precios, append-only)
```

| Carpeta         | Qué contiene                                                                                                           | Reglas                                                                          |
| --------------- | ---------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `src/review`    | Catálogo de campos por tipo de candidato (`fields.ts`), planificador masivo (`bulk.ts`), textos legibles (`labels.ts`) | **Puro** (ESLint + `purity.test.ts`); no decide nada que ya decida `src/import` |
| `src/admin`     | `permissions.ts` (capacidades), `handlers.ts` (frontera del servidor), `filters.ts` (URL → filtros validados)          | Toda mutación pasa por aquí                                                     |
| `src/db/admin`  | `tx.ts`, `review.ts`, `bulk.ts`, `imports.ts`, `catalog.ts`, `pricing.ts`, `dashboard.ts`                              | Reciben `Queryable`; la transacción la maneja quien llama                       |
| `src/app/admin` | Páginas (componentes servidor), componentes cliente, `actions.ts`, `_server/` (pool y actor), `admin.css`              | Sin SQL, sin pricing, sin adaptador (`admin-boundaries.test.ts`)                |

## Rutas

| Ruta                        | Qué es                                                                           |
| --------------------------- | -------------------------------------------------------------------------------- |
| `/admin`                    | Métricas reales; cada una abre su lista                                          |
| `/admin/imports`            | Lotes importados                                                                 |
| `/admin/imports/[id]`       | Workbook, hash, parser, fechas, conteos, tipo × estado, issues, progreso         |
| `/admin/review`             | Inbox: búsqueda, filtros, orden, paginación, selección, cambios masivos          |
| `/admin/review/[id]`        | Source · Normalized · Resolution · Domain preview, issues, históricos, auditoría |
| `/admin/review/audit`       | Operaciones masivas y últimas decisiones                                         |
| `/admin/catalog`            | Buscador de CatalogItems                                                         |
| `/admin/catalog/new`        | Alta mínima                                                                      |
| `/admin/catalog/[id]`       | Detalle, edición de campos seguros, historial                                    |
| `/admin/pricing`            | Items con precios                                                                |
| `/admin/pricing/[id]`       | Matrices, reglas, México (dominio), simulador, evidencia histórica               |
| `/admin/pricing/historical` | Toda la evidencia histórica, sin acciones                                        |

## Base de datos (migración 0014)

| Estructura                                 | Para qué                                                                                               |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------ |
| `import_candidate.resolution`              | (ya existía) ahora también guarda el **borrador** mientras el candidato no está APPROVED               |
| `import_candidate.open_fields`             | Campos que siguen abiertos **después** del borrador (calculado con `unresolvedFields` en TypeScript)   |
| `review_event`                             | Auditoría por campo: candidato, acción, campo, antes, después, actor, motivo, origen, operación masiva |
| `review_bulk_operation`                    | Metadatos de cada cambio masivo                                                                        |
| `change_event.context` + `record_change()` | `changed_by` = actor de la aplicación (`dtg.actor`), `context` = qué acción (`dtg.context`)            |
| `v_review_candidate`                       | Proyección para filtrar/ordenar/paginar en el servidor (no decide nada)                                |

## Next.js 16

- `params` y `searchParams` son promesas; las páginas llaman a `connection()` antes de leer la base.
- Las Server Actions son POST alcanzables directamente: la validación completa está en `handlers.ts`, nunca en el formulario.
- `refresh()` + `revalidatePath()` tras cada mutación exitosa.

## Extensión prevista (sin construirla)

- **Roles** (`viewer`, `editor`, `price_authorizer`, `admin`): cambiar `ROLE_GRANTS` en `permissions.ts`; cada handler ya declara su capacidad.
- **STEP 05C**: los grupos de decisión entran como `candidateIds` + `decisionGroup` al mismo `bulkApplyHandler` (origen `DECISION_GROUP`), y como `?ids=` en el inbox. Ver [BULK-OPERATIONS](BULK-OPERATIONS.md).
- **Auth real**: `getActor()` es el único punto que resuelve quién es el usuario.
