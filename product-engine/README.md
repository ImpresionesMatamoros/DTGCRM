# DTG Product Engine

Fuente maestra estructurada de **identidad de productos, configuración y pricing** de Design To Go. Sustituirá progresivamente al Excel del catálogo. El CRM la consumirá **sólo por HTTP**, nunca con acceso directo a la base de datos.

**Estado:** STEP 06 · Admin MVP / Review Console en `/admin` (revisión de candidatos importados, cambios masivos auditados, catálogo básico, visor de precios) sobre el pipeline de importación de STEP 05B y la Foundation de STEP 04. Sin Supabase remoto, sin despliegue, sin integración con el CRM, sin publicación REAL.

## Inicio rápido

```bash
pnpm install
cp .env.example .env
pnpm db:start        # Postgres 16 en Docker (o usa uno local y ajusta DATABASE_URL)
pnpm db:rebuild      # reset → migraciones → seeds → pruebas de integración
pnpm verify          # lint + typecheck + pruebas unitarias + build
pnpm dev             # http://localhost:3000/admin  (escribe tu nombre en "Actor")

# Importación (requiere Python ≥ 3.11 + openpyxl y los workbooks fuera del repo)
pnpm importer:test                                        # pruebas del importador sin workbooks
DTG_SOURCES=/ruta/workbooks pnpm importer:envelopes       # Excel → .import/envelopes/*.envelope.json
DTG_SOURCES=/ruta/workbooks pnpm import:dry-run           # staging + validación + adaptador en seco + reporte
```

## Qué contiene

- `src/domain`, `src/pricing`, `src/api`, `src/shared`: dominio puro, resolvedor de precios determinista y contrato v1 (Zod).
- `src/db`: carga del catálogo desde PostgreSQL.
- `supabase/migrations`: esquema completo, reproducible desde Git.
- `data/` → `supabase/seeds`: datos de referencia y el vertical slice de desarrollo (16 items, 131 tarifas autorizadas reales).
- `tools/excel-importer`: parser Python de STEP 05A (sin cambios) + exportador `ImportEnvelope`.
- `src/import` (puro) y `src/db/import`: contrato, staging, revisión, adaptador de dominio, publicación controlada y procedencia.
- `src/review` (puro), `src/admin`, `src/db/admin` y `src/app/admin`: consola de revisión y admin (STEP 06).
- `tests/unit` (sin BD), `tests/db` (integración) y `tests/e2e` (Playwright, flujos críticos).

## Documentación

| Documento                                                  | Tema                                                                     |
| ---------------------------------------------------------- | ------------------------------------------------------------------------ |
| [ARCHITECTURE](docs/ARCHITECTURE.md)                       | Capas, frontera con el CRM, flujo de precio                              |
| [DOMAIN-MODEL](docs/DOMAIN-MODEL.md)                       | Conceptos implementados                                                  |
| [DATABASE](docs/DATABASE.md)                               | Migraciones e invariantes                                                |
| [PRICING](docs/PRICING.md)                                 | Precedencia, modelos, resultado                                          |
| [LOCAL-DEVELOPMENT](docs/LOCAL-DEVELOPMENT.md)             | Guía completa y scripts                                                  |
| [DECISIONS](docs/DECISIONS.md) · [ADR](docs/adr/README.md) | Decisiones y desviaciones                                                |
| [STEP 04 report](docs/STEP_04_FOUNDATION_REPORT.md)        | Cierre de Foundation                                                     |
| [import/ARCHITECTURE](docs/import/ARCHITECTURE.md)         | Pipeline de importación (STEP 05B)                                       |
| [import/…](docs/import/)                                   | Contrato, staging, procedencia, revisión, reimportaciones, dry run       |
| [STEP 05B report](docs/STEP_05B_REPORT.md)                 | Cierre de STEP 05B                                                       |
| [admin/…](docs/admin/)                                     | Admin MVP: arquitectura, revisión, masivos, catálogo, precios, seguridad |
| [STEP 06 report](docs/STEP_06_ADMIN_REPORT.md)             | Cierre de STEP 06                                                        |
