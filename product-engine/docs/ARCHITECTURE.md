# Arquitectura — DTG Product Engine (Foundation)

## Propósito y frontera

Product Engine es la fuente maestra de **qué vende Design To Go, cómo se configura, cómo se compone y cómo se determina su precio**. No es el CRM: no guarda clientes, cotizaciones, ajustes negociados, pagos ni work orders.

```
CRM ──HTTP──▶ Product Engine API ──▶ PostgreSQL
            (STEP 05+)            (sólo Product Engine accede)
```

El CRM **nunca** tendrá credenciales de la base de datos. En Foundation sólo existe `GET /api/v1/health`.

## Capas

| Capa          | Carpeta       | Depende de       | Reglas                                                                                                                   |
| ------------- | ------------- | ---------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Shared        | `src/shared`  | `decimal.js`     | `Money` con moneda obligatoria                                                                                           |
| Dominio       | `src/domain`  | shared           | Tipos y funciones puras: identidad, opciones, decoración, composición, mercado, publicación, validación de configuración |
| Pricing       | `src/pricing` | dominio, shared  | `resolvePrice(request, snapshot, asOf)` puro y determinista                                                              |
| Contratos     | `src/api`     | dominio, pricing | Esquemas Zod del wire v1 (snake_case, importes como string decimal)                                                      |
| Persistencia  | `src/db`      | `pg`, dominio    | Carga un `CatalogSnapshot` desde PostgreSQL                                                                              |
| App           | `src/app`     | todo             | Next.js; hoy sólo health                                                                                                 |
| Datos semilla | `data/`       | dominio          | Datasets tipados → SQL generado y snapshot de pruebas                                                                    |

**Pureza garantizada** (gate M1): ESLint prohíbe en `src/{shared,domain,pricing,api}` importar `pg`, `@/db`, `next`, `react` y usar `Date.now()`, `new Date()` sin argumentos y `Math.random()`; `tests/unit/purity.test.ts` lo verifica de nuevo sobre el código fuente.

## Flujo de un precio

```
PriceRequest ─▶ validateConfiguration ─▶ política de mercado del item
                                            │
              ┌─────────── MASTER / MANUAL ─┴─ DERIVED ───────────┐
              ▼                                                    ▼
      priceInBook(book del mercado)                 priceInBook(book fuente USD)
              │                                     × factor (item o default) × FX(asOf)
              ▼                                                    │
   componentes opcionales: resolvePrice(hijo, mercado) ◀───────────┘
              ▼
          PriceResult (RESOLVED | QUOTE_ONLY | INVALID | AMBIGUOUS)
```

## Decisiones clave

Ver [`DECISIONS.md`](DECISIONS.md) y [`adr/`](adr/README.md). Las más estructurales: identidad UUID + `DTG-00001` (ADR-0011), reloj explícito (ADR-0009), `Money` con moneda (ADR-0008), políticas de mercado persistentes y resueltas por item (ADR-0003/0010), históricos sólo como evidencia (ADR-0005), variantes sin persistencia todavía (ADR-0007).

## Qué no existe (a propósito)

Variant, bundle, marcas/proveedores/sourcing, inventario, compras, producción, contabilidad, work orders, UI de administración, importador masivo, Supabase remoto, despliegue.
