# STEP 07 — Reporte final: Pricing productionization

Rama `step07/pricing-productionization`, desde `db5258b` (baseline STEP 06).

## Entregado

- Migración `0015_price_revisions.sql` (0001–0014 intactas): linaje de revisiones, `change_event.reason`, guardas de choque y trigger diferido.
- Servicios: borradores, clonar, autorizar con lock + savepoint, conflictos, simulación de borrador, impacto, comparación, historial, políticas de mercado, revisiones FX.
- Capability `price.authorize` (rol local; **D-016 abierta**).
- UI admin: lista/detalle de definiciones, editor de borrador, políticas, parámetros FX, readiness Commercial Print, decisiones D-001…D-022 (sólo lectura), simulador enriquecido.
- Docs en `docs/step07/`, ADR-0017, actualización de PRICING/DATABASE/DECISIONS.

## Cierre del pendiente heredado de STEP 06 (workbooks fuente)

- SHA-256 de los 5 workbooks verificados contra `SHA256SUMS.txt`: todos OK. No se modificaron.
- Importados con el pipeline existente (`import:dry-run`, sin escrituras al dominio): **413 candidates reales** en staging.
- Playwright A–E (más F): **6/6 pasan** con staging poblado → pendiente heredado **cerrado**; no era regresión.

## Verificación (BD local, PostgreSQL 16 plano)

| Chequeo                                                 | Resultado                             |
| ------------------------------------------------------- | ------------------------------------- |
| eslint, prettier, tsc                                   | limpios                               |
| Unit (vitest)                                           | 174 pasan                             |
| DB (`db:rebuild`, incluye carrera real de concurrencia) | 111 pasan                             |
| Python importer                                         | 39 pasan                              |
| `seed:check`, `pnpm build`                              | OK                                    |
| Playwright (BD limpia + 413 candidates)                 | **12/12** (A–F + 6 flujos de pricing) |

Durante la verificación E2E se encontró y corrigió un bug propio: la lista de definiciones daba 500 al filtrar por ítem sin filtro de vigencia (parámetro SQL sin tipo). Se corrigió en `price-views.ts`.

Nota operativa: los E2E escriben en la BD; las pruebas DB esperan BD limpia, por eso se corrieron tras `db:rebuild` y los E2E tras reimportar staging.

## No ejecutado / límites honestos

- CI de GitHub y Docker no se ejecutaron (BD local plana, ADR-0012).
- Convertir candidato aprobado → borrador: no implementado (opcional).
- Sin Supabase remoto, CRM, publicación REAL, motor de impuestos ni autoactivación de precios importados.
- Abiertas por decisión del dueño (no resueltas por inferencia): D-016, D-022 (IVA), D-008, D-010, D-011; redondeo MX HALF_UP_2 es comportamiento técnico provisional.
