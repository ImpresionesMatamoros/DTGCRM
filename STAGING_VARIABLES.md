# Configuración y secretos

La configuración pública operativa está en `staging/laboratory.json`. Usar `STAGING_CONFIG_FILE=staging/laboratory.json` y confirmar `STAGING_CONFIRMED_PROJECT_REF=hhzqmqndavqqswerjhxe`.

Modo: `databaseIsolation=shared-staging-project`, `crmSchema=public`, `peSchema=dtg_pe`. El guard acepta el engine en el origen Supabase solamente para la ruta revisada `/functions/v1/product-engine`.

Publicables: URL del sitio, URL Supabase, project ref y publishable key. No son claves administrativas.

Privados, únicamente servidor:
- `STAGING_DATABASE_URL`: conexión postgres del proyecto de pruebas, para aprovisionamiento explícito.
- `STAGING_PE_DATABASE_URL`: misma base staging; operaciones administrativas PE siempre limitadas a dtg_pe.
- `SUPABASE_ACCESS_TOKEN`: solo cuando se utiliza el CLI para desplegar funciones.
- Vault `staging_pe_db_password` y `staging_pe_api_token`: generados nuevos; nunca frontend, Git, reportes o ZIP.
- SUPABASE_SERVICE_ROLE_KEY y SUPABASE_DB_URL: variables internas de Edge, no añadidas al cliente.

`scripts/staging/shared-runtime.cjs` crea credenciales una única vez y rechaza sobreescribirlas. El runtime verifica el proyecto exacto antes de leerlas.

Las pruebas remotas reciben la contraseña ficticia por stdin oculto. Nunca almacenan credenciales en sus JSON.
