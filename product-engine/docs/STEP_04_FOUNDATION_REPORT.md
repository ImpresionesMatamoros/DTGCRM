# STEP 04 — Foundation Report · DTG Product Engine

**Alcance autorizado:** M0 Repository Foundation · M1 Domain & Contracts · M2 Local Persistence.
**Fecha:** 2026-09-30 · **Commit de cierre:** ver `git log` (rama `main`).

## 1. Qué se construyó

- **Repositorio `dtg-product-engine`** (Git local, 13 commits auditables): Next.js 16 + TypeScript estricto, ESLint con guardas de pureza, Prettier, Vitest (proyectos `unit` y `db`), `.env.example`, `docker-compose.yml`, CI de GitHub Actions y endpoint de salud.
- **Dominio puro** (`src/domain`, `src/shared`): identidad `CatalogItem` (`PRODUCT | SERVICE`) con UUID + `DTG-00001`, estado nullable “no asignado”, categorías, opciones tipadas con valores controlados por item y opciones distribuibles, decoración (blank = sin selección), composición, mercados, price books, `ItemMarketPolicy` persistente, parámetros FX versionados, definiciones/breaks/condiciones/reglas de precio, presentación, publicación, procedencia y `Money` con moneda obligatoria.
- **Pricing determinista** (`src/pricing`): `resolvePrice(request, snapshot, asOf)` con FIXED, PER_UNIT, EXACT_QUANTITY_MATRIX (sin interpolación), TIERED, MEASURED, derivación México (factor default o del item × FX vigente), MANUAL estricto, QUOTE_ONLY, reglas por fila de distribución con grupos de exclusividad, decoraciones con precio propio y componentes opcionales resueltos con su propia política de mercado.
- **Contrato wire v1** (`src/api/contracts.ts`): esquemas Zod snake_case; importes como string decimal + moneda. Sin transporte todavía.
- **Persistencia local** (`supabase/migrations`, `scripts/db.ts`, `src/db`): 11 migraciones SQL, runner con checksums, seeds generados desde datasets tipados, cargador de snapshot desde PostgreSQL.
- **Datos:** referencia (mercados, books, FX 16.50 provisional, factor 0.70, métodos DTF/EMBROIDERY/SCREEN_PRINTING/HTV, perfiles de publicación) y **dev slice** de STEP 03 (16 items, 14 definiciones autorizadas = 131 tarifas reales de v1.2, reglas 2XL/3XL, evidencia histórica, presentaciones, decisiones).
- **Documentación:** README, ARCHITECTURE, DOMAIN-MODEL, DATABASE, PRICING, LOCAL-DEVELOPMENT, DECISIONS y 13 ADR.

## 2. Estructura final del repo

```
dtg-product-engine/
├── .github/workflows/ci.yml        CI: lint, format, typecheck, unit, seed:check, db:rebuild, migrate, build
├── data/                           datasets tipados (fuente de seeds y del snapshot de pruebas)
│   ├── reference.ts · types.ts · ids.ts (UUID v5 deterministas)
│   └── dev-slice/  index.ts · authorized-prices.v1_2.json · README.md
├── docs/                           ARCHITECTURE · DOMAIN-MODEL · DATABASE · PRICING · LOCAL-DEVELOPMENT · DECISIONS · este reporte
│   └── adr/                        ADR-0001 … ADR-0013
├── scripts/  db.ts · generate-seeds.ts
├── src/
│   ├── app/                        layout, page, api/v1/health
│   ├── api/contracts.ts            contrato wire v1 (Zod)
│   ├── db/  client.ts · catalog-snapshot.ts
│   ├── domain/                     catalog, options, decoration, composition, market, pricing-model,
│   │                               publication, provenance, snapshot, configuration
│   ├── pricing/  resolve.ts · result.ts
│   └── shared/money.ts
├── supabase/
│   ├── migrations/  0001 … 0011
│   └── seeds/  0001_reference.generated.sql · 0002_dev_slice.generated.sql
├── tests/
│   ├── fixtures/slice.ts           snapshot del slice + FIXTURES sintéticos
│   ├── unit/                       10 archivos (sin BD)
│   └── db/                         3 archivos + helpers (integración)
├── docker-compose.yml · .env.example · eslint.config.mjs · vitest.config.mts · next.config.ts · tsconfig.json
└── AGENTS.md · CLAUDE.md           generados por `next dev` (Next 16); se versionan para mantener el árbol limpio
```

Desviación menor frente a la estructura sugerida: no hay `supabase/seed.sql` único; hay `supabase/seeds/*.sql` por capa (ADR-0013).

## 3. Migraciones

| #   | Archivo                           | Resumen                                                                                                                             |
| --- | --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `0001_catalog_core.sql`           | enums base, `next_public_code()`, `catalog_item` + guarda                                                                           |
| 2   | `0002_categories.sql`             | `category`, `catalog_item_category`                                                                                                 |
| 3   | `0003_options.sql`                | `option_definition`, `option_value`, `item_option`, `item_option_value`                                                             |
| 4   | `0004_decoration.sql`             | `decoration_method`, `decoration_capability`                                                                                        |
| 5   | `0005_composition.sql`            | `composition_line` (sin ciclos, profundidad ≤ 2)                                                                                    |
| 6   | `0006_markets_and_pricebooks.sql` | `market`, `price_book`, `item_market_policy`, `pricing_parameter`                                                                   |
| 7   | `0007_pricing.sql`                | `price_definition`, `price_break`, `price_rule`, `price_rule_assignment`, `price_condition` + guardas de autorización/inmutabilidad |
| 8   | `0008_presentations.sql`          | `presentation`                                                                                                                      |
| 9   | `0009_publications.sql`           | `publication_profile`, `publication_assignment`, `v_publication_membership`                                                         |
| 10  | `0010_provenance.sql`             | `source_reference`, `decision_record`, `decision_subject`                                                                           |
| 11  | `0011_change_events.sql`          | `change_event` append-only, auditoría, `v_revisions`                                                                                |

26 tablas de negocio/auditoría + `schema_migrations`. No existen: `variant`, `variant_option_value`, `bundle_line`, `brand`, `supplier`, `sourcing_option`, inventario, compras, work orders, producción (verificado por prueba).

## 4. Pruebas

**103 pruebas automatizadas** (79 unitarias sin BD + 24 de integración).

| Archivo                           | Cubre                                                                                                                                                                                                                                                                                                                                                                                  |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `unit/money.test.ts`              | Money sin moneda imposible (tipo y runtime), monedas no mezclables, conversión y redondeo                                                                                                                                                                                                                                                                                              |
| `unit/catalog.test.ts`            | Identidad y código público, independencia de categoría, status sin quinto estado, publicación de status NULL                                                                                                                                                                                                                                                                           |
| `unit/configuration.test.ts`      | Opciones válidas/inválidas, valores controlados por item, TEXT, distribución, capacidad de decoración, DTF método ≠ producto, opciones que afectan precio (derivadas)                                                                                                                                                                                                                  |
| `unit/composition-market.test.ts` | Relación padre/hijo, opcional, ciclos/profundidad; política de mercado y vigencias                                                                                                                                                                                                                                                                                                     |
| `unit/pricing.slice.test.ts`      | Casos reales STEP 03: Premium 2c×500 = 120 USD; Flyer Premium 2c ½ carta ×1000 = 400 USD; México derivado 1386.00 MXN con procedencia de fórmula; 750 → QUOTE_ONLY sin interpolar; 9 L + 3 3XL sin base → QUOTE_ONLY con +9 USD conocido; gorra rechaza talla; imanes; componentes no activos; servicio sobre artículo del cliente; vigencias por `asOf`; determinismo                 |
| `unit/pricing.fixtures.test.ts`   | Base de volumen 12 con recargo sólo en 3 unidades; blank vs decorado; MANUAL con y sin configuración manual; MANUAL sin reglas MX; factor por item; QUOTE_ONLY por política; reglas en conflicto → AMBIGUOUS; definiciones empatadas; Yard Sign + Stake con factores distintos por item; incluidos sin importe; MEASURED; REQUIRE_QUOTE; toda cifra con moneda                         |
| `unit/contracts.test.ts`          | Parseo del request wire; rechazo de campos desconocidos; resultado serializado con strings decimales y moneda                                                                                                                                                                                                                                                                          |
| `unit/purity.test.ts`             | Capas puras sin `pg`, `@/db`, Next/React, `Date.now()`, `new Date()`, `Math.random()`                                                                                                                                                                                                                                                                                                  |
| `unit/dataset.test.ts`            | Volúmenes del slice, invariantes de dominio, sin definiciones duplicadas, históricos sólo como evidencia, sin FIXTURE, IDs de migración sólo como procedencia                                                                                                                                                                                                                          |
| `unit/health.test.ts`             | Endpoint de salud                                                                                                                                                                                                                                                                                                                                                                      |
| `db/schema.test.ts`               | Migraciones aplicadas = archivos en Git con checksum; tablas exactas; estructuras diferidas ausentes; enums sin BUNDLE ni quinto estado                                                                                                                                                                                                                                                |
| `db/constraints.test.ts`          | Código público e inmutabilidad; status no vuelve a NULL; servicio vs producto; valores de opción de otra definición; distribuibles; decoración en items NONE; ciclos y profundidad; forma por modelo; inmutabilidad y no borrado de AUTHORIZED; requisitos de autorización; reglas; `ItemMarketPolicy` persistente (DERIVED 0.50 / MANUAL); FX sin traslapes; change_event append-only |
| `db/seed-and-snapshot.test.ts`    | Volúmenes de seed; históricos no resolubles; publicación como consulta (CRM 12 items, catálogo, lista USA); status NULL nunca publicado; **snapshot desde BD ≡ dataset en memoria**; slice cotizado desde la BD; políticas persistidas de componentes resolviendo independientemente                                                                                                   |

## 5. Resultado de los gates

Ejecutados sobre un **clon limpio** del repositorio (`git clone` → `pnpm install --frozen-lockfile` → `.env` desde `.env.example`) contra PostgreSQL 16 local nativo.

| Gate  | Verificación                      | Resultado                                                                                      |
| ----- | --------------------------------- | ---------------------------------------------------------------------------------------------- |
| M0    | install                           | PASS (lockfile congelado)                                                                      |
| M0    | lint                              | PASS (0 errores)                                                                               |
| M0    | format                            | PASS                                                                                           |
| M0    | typecheck                         | PASS                                                                                           |
| M0    | test                              | PASS (79/79)                                                                                   |
| M0    | build                             | PASS (`next build`)                                                                            |
| M1    | Domain tests                      | PASS                                                                                           |
| M1    | Sin dependencia de BD en dominio  | PASS (ESLint + `purity.test.ts`; sonda de violación comprobada)                                |
| M1    | Sin `Date.now` en pricing         | PASS (idem)                                                                                    |
| M1    | Money siempre con moneda          | PASS (tipo, runtime, recorrido de resultados, wire)                                            |
| M2    | Fresh DB rebuild                  | PASS (`db:rebuild`: reset → 11 migraciones → 2 seeds → 24/24)                                  |
| M2    | Migrations                        | PASS; re-ejecución idempotente (“schema up to date”); migración alterada detectada y rechazada |
| M2    | Seeds                             | PASS; `seed:check` sin deriva                                                                  |
| M2    | Integration tests                 | PASS (24/24)                                                                                   |
| M2    | No manual DB changes              | PASS (esquema reconstruido sólo desde Git; prueba de igualdad migraciones↔archivos)            |
| Extra | `pnpm dev` + `GET /api/v1/health` | PASS (200)                                                                                     |
| Extra | Runner rechaza hosts remotos      | PASS                                                                                           |

**No verificado en este entorno:** `pnpm db:start` con Docker (el registro Docker Hub está bloqueado aquí) y la ejecución real del workflow en GitHub (no hay remoto ni credenciales). Ver P1-07.

## 6. Desviaciones respecto a STEP 03

Detalle en `docs/DECISIONS.md`: sin `BUNDLE` en el enum (D1); PostgreSQL plano en vez de Supabase CLI local (D2); sin RLS/roles (D3); sin `sourcing_override`/`variant_id` (D4); roles de composición sólo INCLUDED/OPTIONAL (D5); componentes resueltos por item (D6); seeds generados (D7); 131 tarifas = 130 breaks + 1 FIXED (D8); `knownLines` y línea `MARKET_DERIVATION` (D9); revisión por fila (D10); capacidades prohibidas en items `NONE` (D11); `label` en reglas (D12); FX canónico `16.50` (D13); unidades de venta `null` donde el Excel no las tenía (D14). Ninguna altera el modelo conceptual aprobado.

## 7. ADRs nuevos

ADR-0007 persistencia de Variant diferida · ADR-0008 Money con moneda explícita · ADR-0009 reloj explícito en pricing · ADR-0010 mercado resuelto por CatalogItem en componentes · ADR-0011 código público `DTG-00001` · ADR-0012 PostgreSQL local plano con migraciones propias · ADR-0013 capas de datos. Además: addendum a ADR-0003 (política de mercado persistente). ADR-0001…0006 importados de STEP 03.

## 8. Deuda técnica

| #   | Deuda                                                        | Por qué es aceptable ahora                                                              |
| --- | ------------------------------------------------------------ | --------------------------------------------------------------------------------------- |
| T1  | Revisión por fila, no por transacción                        | Monótona y suficiente para snapshots; agrupar por transacción cuando exista UI de admin |
| T2  | El snapshot carga todo el catálogo por consulta              | 16 items; cachear por revisión en STEP 05                                               |
| T3  | Validación de `spec` en BD sólo estructural (claves)         | El dominio valida positividad; endurecer al crear la UI de admin                        |
| T4  | Trigger de ciclos no protegido ante inserciones concurrentes | Un solo administrador; bloqueo explícito cuando haya escritura por API                  |
| T5  | Sin RLS/roles de API                                         | Local; se diseña con el acceso del CRM (P1-06)                                          |
| T6  | `AGENTS.md`/`CLAUDE.md` generados por Next 16                | Se versionan porque `next dev` los re-crea                                              |
| T7  | Explicaciones en español fijas en el resolvedor              | Suficiente para CRM interno; i18n cuando haya catálogo público                          |

## 9. P1 / P2 abiertos

**P1** (no bloquean Foundation; resolver antes de datos productivos o integración con el CRM):

| ID    | Tema                                                                                                                                                |
| ----- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| P1-01 | Confirmar estado de los 16 items del slice (sembrados provisionalmente)                                                                             |
| P1-02 | Redondeo MXN e IVA en precios México derivados                                                                                                      |
| P1-03 | Imanes: ¿2 pares = 130 USD? (hoy FIXED con máximo 1)                                                                                                |
| P1-05 | Alcance del recargo 2XL/3XL (hoy algodón y Dry Fit)                                                                                                 |
| P1-06 | Quién autoriza precios; autenticación del CRM; RLS/roles                                                                                            |
| P1-07 | **Nuevo:** crear el repositorio en GitHub, hacer push y confirmar el primer run de CI; verificar `pnpm db:start` con Docker en la máquina de Martín |

P1-04 (formato de código público) **cerrado** por ADR-0011.

**P2:** tallas/segmentos (S–XL provisionales) · Yard Sign 25/20/18 exacto vs umbral · modo MX manual con fallback · un servicio multi-método vs cuatro · estado/unidad de DTF Transfer y Gang Sheet · redondeo de medidas y mínimos · herencia de opciones a componentes · canopy y bundles · sourcing/costos · invitaciones legacy · lista waterproof · ubicaciones de decoración · taxonomía PIN/FAB/FOT/PPE.

## 10. Propuesta para STEP 05 (no iniciado)

**STEP 05 — API v1 local y contrato ejecutable** (todavía sin Supabase remoto ni CRM):

1. Route handlers `/api/v1`: `search`, `items/:id`, `items/:id/schema`, `validate`, `price`, `revision`, usando los contratos Zod existentes y `asOf` generado en la frontera.
2. Autenticación por token de servicio (sólo local) y decisión documentada de roles/RLS (cierra P1-06 en diseño).
3. Caché del snapshot por `pricing_revision`/`catalog_revision` (T2).
4. JSON Schema del contrato publicado en `docs/contracts/` para el equipo del CRM.
5. Pruebas de API (Vitest) y, sólo si hay una página que lo amerite, un smoke de Playwright.
6. Paralelamente, sesión corta con el dueño para P1-01, P1-02, P1-03 y P1-05.

## 11. Requirement · Status · Evidence

| Requirement                                                               | Status                        | Evidence                                                   |
| ------------------------------------------------------------------------- | ----------------------------- | ---------------------------------------------------------- |
| Leer STEP 03 antes de programar                                           | DONE                          | ADR 0001–0006 importados; desviaciones en DECISIONS        |
| Patch 1 · Variant no físico                                               | DONE                          | ADR-0007; `db/schema.test.ts`                              |
| Patch 2 · Money con moneda                                                | DONE                          | ADR-0008; `money.test.ts`, recorrido de resultados, wire   |
| Patch 3 · Reloj explícito                                                 | DONE                          | ADR-0009; ESLint; `purity.test.ts`; pruebas de `asOf`      |
| Patch 4 · Mercado por item en componentes                                 | DONE                          | ADR-0010; prueba Yard Sign + Stake (memoria y BD)          |
| Patch 5 · ItemMarketPolicy persistente                                    | DONE                          | `item_market_policy`; `constraints.test.ts`; round trip BD |
| Stack TS/Next/React/Postgres/Zod/Vitest; sin ORM                          | DONE                          | `package.json`; ADR-0012                                   |
| Playwright sólo si amerita                                                | N/A                           | No hay UI que lo amerite                                   |
| Estructura de repo con separaciones                                       | DONE                          | §2                                                         |
| Git fuente de verdad del esquema                                          | DONE                          | runner con checksums; prueba migraciones = archivos        |
| Scripts dev/build/lint/typecheck/test/db:*                                | DONE                          | `package.json`; LOCAL-DEVELOPMENT                          |
| CI básica                                                                 | DONE (no ejecutada en GitHub) | `.github/workflows/ci.yml`; P1-07                          |
| Contratos de dominio (lista completa)                                     | DONE                          | `src/domain`, `src/shared`                                 |
| CatalogItem PRODUCT/SERVICE, Bundle diferido                              | DONE                          | enum; `catalog.ts`                                         |
| Options sin tabla por atributo                                            | DONE                          | `0003_options.sql`                                         |
| Decoration separado; blank = sin selección                                | DONE                          | ADR-0004; `configuration.test.ts`                          |
| Composition sin master paralelo                                           | DONE                          | `composition_line`; pruebas                                |
| Pricing: fixed, matriz exacta, QUOTE_ONLY, derivado MX, overrides, reglas | DONE                          | `pricing.*.test.ts`                                        |
| Volumen 12 / recargo sobre 3                                              | DONE                          | prueba TIERED fixture (129.00) y QUOTE_ONLY (+9 conocido)  |
| PriceResult explícito y trazable                                          | DONE                          | `result.ts`; `contracts.ts`                                |
| Public code `DTG-00001`                                                   | DONE                          | ADR-0011; checks BD                                        |
| No crear tablas diferidas                                                 | DONE                          | `schema.test.ts`                                           |
| Seeds reproducibles; referencia vs dev vs fixtures                        | DONE                          | ADR-0013; `seed:check`; prueba sin FIXTURE                 |
| Status no confirmado = NULL, no publicado                                 | DONE                          | ADR-0002; pruebas de publicación                           |
| Históricos fuera de PriceDefinition                                       | DONE                          | ADR-0005; pruebas BD y dataset                             |
| Sin CRM con acceso directo                                                | DONE                          | Sin credenciales/roles para CRM; ARCHITECTURE              |
| Tests obligatorios (dominio, pricing, composición)                        | DONE                          | §4                                                         |
| Database rebuild test                                                     | DONE                          | §5, clon limpio                                            |
| Documentación requerida                                                   | DONE                          | README + docs/*                                            |
| Commits pequeños                                                          | DONE                          | 13 commits                                                 |
| Sin Supabase remoto / deploy / CRM                                        | DONE                          | runner rechaza hosts remotos; nada desplegado              |

## 12. Auditoría crítica propia

Revisé la implementación buscando lo que haría fallar Foundation:

- **Reproducibilidad:** probada dos veces desde clon limpio; el único camino no probado es Docker (entorno sin acceso a Docker Hub) y CI en GitHub. El resto del flujo no depende de Docker (cualquier Postgres local). Riesgo bajo, registrado como P1-07.
- **Datos provisionales:** estados y tallas S–XL del dev slice están marcados provisionales en datos, `decision_record` OPEN y documentación. No se usan como verdad productiva.
- **Precios inventados:** ninguno en seeds; todas las cifras sintéticas viven en `tests/fixtures` o en transacciones revertidas y se verifican ausentes en la base.
- **Fuga de pricing al CRM:** el resolvedor entrega corrida de tallas, recargos, conversión y componentes; el CRM no necesita recalcular nada.
- **Complejidad:** 26 tablas, todas con evidencia o requeridas por el brief; ninguna infraestructura especulativa (variant, bundle, sourcing ausentes).
- **Hallazgo corregido durante la auditoría:** la restricción `merge_requires_retired` aceptaba status NULL (lógica de tres valores de SQL); se corrigió con `coalesce` y hay prueba.
- **Hallazgo corregido:** faltaba cobertura de MANUAL con reglas USD sin contraparte MX; se agregó la prueba.

No hay P0.

## Clasificación

**PASS WITH P1 OPEN ITEMS — FOUNDATION COMPLETE**
