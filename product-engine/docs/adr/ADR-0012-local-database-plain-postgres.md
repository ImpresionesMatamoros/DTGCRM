# ADR-0012 — Base de datos local: PostgreSQL plano, migraciones SQL propias

**Estado:** ACEPTADO (STEP 04)

## Contexto

El brief permite Supabase local “únicamente si facilita PostgreSQL/migrations”. El stack local de Supabase levanta ~10 contenedores (auth, storage, realtime, studio…) que Foundation no usa. Además, en el entorno donde se construyó STEP 04 no hay acceso a Docker Hub, por lo que se validó contra PostgreSQL 16 nativo.

## Decisión

- Desarrollo local contra **PostgreSQL 16** (vía `docker-compose.yml` o instalación nativa; basta `DATABASE_URL`).
- Migraciones SQL explícitas en `supabase/migrations/NNNN_nombre.sql`, aplicadas por `scripts/db.ts` y registradas en `schema_migrations` con checksum (una migración aplicada no puede cambiar en silencio).
- SQL compatible con Supabase: sin extensiones exóticas (sólo `btree_gist`, disponible en Supabase), sin roles propietarios de Supabase.
- Sin ORM: cliente `pg` + tipos TypeScript explícitos (el modelo depende de checks, triggers, índices parciales y exclusiones que un ORM no expresa mejor).
- Cuando se autorice Supabase remoto, las mismas migraciones se aplican con la CLI de Supabase (formato `NNNN_nombre.sql` compatible).

## Consecuencias

- Reconstrucción total en segundos (`pnpm db:rebuild`).
- RLS y roles de API quedan para el paso que introduzca Supabase y el acceso del CRM (P1-06).
