# Desarrollo local

## Requisitos

- Node.js ≥ 22 y pnpm 10 (`corepack enable`).
- PostgreSQL 16 local: con Docker (`docker-compose.yml`) **o** una instalación nativa. Sólo se necesita `DATABASE_URL`.
- Para importar: Python ≥ 3.11 y `openpyxl==3.1.5` (`python3 -m pip install -r tools/excel-importer/requirements.txt`) y los cinco workbooks en un directorio fuera del repo (`DTG_SOURCES`).

## De cero a funcionando

```bash
git clone <repo> dtg-product-engine && cd dtg-product-engine
pnpm install
cp .env.example .env          # ajusta DATABASE_URL si no usas docker
pnpm db:start                 # docker compose up -d db (omitir si usas Postgres nativo)
pnpm db:rebuild               # reset → migraciones → seeds → pruebas de integración
pnpm verify                   # lint + typecheck + pruebas unitarias + build
pnpm dev                      # http://localhost:3000  ·  /api/v1/health
```

Con Postgres nativo el usuario necesita permiso `CREATEDB` (el reset borra y recrea la base de `DATABASE_URL` usando la base de mantenimiento `DATABASE_ADMIN_DB`, por defecto `postgres`).

## Scripts

| Script                                        | Qué hace                                                              |
| --------------------------------------------- | --------------------------------------------------------------------- |
| `dev`, `build`, `start`                       | Next.js                                                               |
| `lint`, `format`, `format:check`, `typecheck` | Calidad                                                               |
| `test`                                        | Pruebas unitarias (dominio y pricing, **sin base de datos**)          |
| `test:db`                                     | Pruebas de integración contra la base local                           |
| `test:all`                                    | Ambas                                                                 |
| `db:start` / `db:stop`                        | Levanta/detiene el contenedor Postgres                                |
| `db:reset`                                    | Borra y recrea la base (sólo hosts locales)                           |
| `db:migrate`                                  | Aplica migraciones pendientes; verifica checksums de las aplicadas    |
| `db:seed`                                     | Carga `supabase/seeds/*.sql` en una transacción                       |
| `db:status`                                   | Migraciones aplicadas/pendientes                                      |
| `db:rebuild`                                  | `reset → migrate → seed → test:db`                                    |
| `seed:generate` / `seed:check`                | Regenera / verifica el SQL de seeds desde `data/`                     |
| `verify`                                      | `lint + typecheck + test + build`                                     |
| `importer:test`                               | Pruebas Python del importador (todas con `DTG_SOURCES`)               |
| `importer:envelopes`                          | Excel → `.import/envelopes/` (`--fixtures` → `tests/fixtures/import`) |
| `import:schema`                               | Regenera / verifica (`--check`) el JSON Schema del envelope           |
| `import:stage` / `import:status`              | Staging local de envelopes / listado de lotes                         |
| `import:dry-run`                              | Staging + validación + adaptador en seco + `IMPORT-DRY-RUN-REPORT`    |
| `test:e2e`                                    | `next build` + Playwright (escenarios A–F; necesita staging real)     |

## Admin (STEP 06)

```bash
pnpm db:rebuild                                                    # ⚠ borra el staging
DTG_SOURCES=… pnpm importer:envelopes && pnpm import:dry-run --report /tmp/dry-run.md
pnpm dev                                                           # http://localhost:3000/admin
```

Escribe tu nombre en "Actor" (o define `DTG_ADMIN_ACTOR`). Las pruebas de BD de STEP 04/05B asumen una base limpia: con el staging real cargado o tras correr el E2E, vuelve a `pnpm db:rebuild` antes de `test:db`. Ver [admin/](admin/).

## Reglas de trabajo

- Cambio de esquema = **nueva** migración `NNNN_nombre.sql`. Nunca editar una ya aplicada; nunca cambiar la base a mano.
- Cambio de datos semilla = editar `data/` + `pnpm seed:generate`. No editar `*.generated.sql`.
- Datos sintéticos sólo en `tests/fixtures` (marcados `FIXTURE`).
- El dominio (`src/domain`, `src/pricing`, `src/api`, `src/shared`) no importa `pg` ni Next y no lee el reloj.

## Problemas comunes

- `DATABASE_URL is not set` → copia `.env.example` a `.env`.
- `Refusing to touch non-local database host` → correcto: Foundation sólo trabaja en local.
- `Migration … changed after being applied` → revierte el cambio y crea una migración nueva.
