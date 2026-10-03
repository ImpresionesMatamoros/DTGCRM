# Mantenimiento del laboratorio

El laboratorio existente está provisionado y publicado. No volver a inicializar ni restablecerlo. Todos los comandos se ejecutan en staging y exigen configuración/destino confirmado.

## Comprobación y build

```powershell
$env:STAGING_CONFIG_FILE='staging/laboratory.json'
$env:STAGING_CONFIRMED_PROJECT_REF='hhzqmqndavqqswerjhxe'
pnpm install --frozen-lockfile
pnpm staging:test
pnpm test:pe
node scripts/staging/build-engine.cjs
pnpm staging:build
```

GitHub Actions ejecuta validaciones y genera el frontend en cada push a staging. La publicación privada inicial fue realizada con Sites. Para nuevas publicaciones se reutiliza el proyecto Sites `appgprj_6ac0e34e2d448191a5f3a4044f2adb5a`, con `dist/staging`, manteniendo audiencia privada. Nunca usar GitHub Pages productivo.

## Aprovisionamiento reproducible, solo para base vacía revisada

Orden: baseline CRM (`database.cjs apply-baseline`) → identidad (`init-identity`) → STEP 10 (`apply-step10`) → PE (`pe-database.cjs migrate`, luego `seed`) → rol/Vault/RPC (`shared-runtime.cjs`) → buckets privados/políticas y Realtime (`shared-storage.sql`) → usuarios ficticios confirmados → fixtures (`database.cjs seed`) → funciones (`deploy-functions.cjs`) → build/publicación → pruebas.

Baseline requiere `STAGING_SCHEMA_REVIEWED=true`, public vacío y cero usuarios Auth. PE requiere `STAGING_CONFIRMED_PE_PROJECT_REF`, `STAGING_PE_SCHEMA_REVIEWED=true`, `STAGING_PE_SOURCE=product-engine`; seed además `STAGING_PE_SEEDS_CONFIRMED=true`. Esta configuración y los adaptadores están fijados al proyecto nuevo actual: otro destino requiere revisión explícita de identidad y guard, nunca un cambio silencioso.

`database.cjs preflight` permite únicamente los dos secretos nuevos previstos en modo compartido y rechaza triggers de envío, cron activo y suscripciones push. No existe reset/clone. No reproducir la prueba de caída dejando el engine deshabilitado: debe restaurarse inmediatamente.

## Catálogo y pruebas

El seed de desarrollo no es el catálogo final comercial. Revisiones de precio siguen el procedimiento original: DRAFT → copia de breaks/conditions → autorización → supersede del anterior; no se editan revisiones autorizadas. `staging/price-revision-test.sql` es una fixture de aceptación exclusiva de staging.

Pruebas reales y capturas: `staging/live-test-results.json`, `staging/ui-live-results.json`. Los scripts LIVE reciben una contraseña de prueba por stdin oculto. No incluyen secretos administrativos ni datos de clientes reales.
