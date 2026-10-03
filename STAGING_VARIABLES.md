# Variables — separación STAGING

No poner secretos en Git, ZIP, logs, browser ni artefactos. Nunca copiar valores de producción. `environment.local.json`, `.env*`, `node_modules` y `dist` están ignorados. La clave publishable es pública; service-role, tokens PE y DB passwords no.

## JSON runtime / variables de GitHub Environment staging

| Variable CI | Campo JSON | Requisito |
|---|---|---|
| STAGING_APP_URL | appUrl | URL HTTPS del hosting separado; sin ruta/query |
| STAGING_CRM_PROJECT_REF | crmProjectRef | ID real del proyecto CRM staging nuevo |
| STAGING_PE_PROJECT_REF | peProjectRef | ID real del proyecto PE staging nuevo, distinto |
| STAGING_SUPABASE_URL | supabaseUrl | `https://<crm-ref>.supabase.co` |
| STAGING_SUPABASE_PUBLISHABLE_KEY | supabasePublishableKey | Publishable de CRM staging, nunca service-role |
| STAGING_PE_BASE_URL | productEngineUrl | Base HTTPS del servicio PE staging |
| STAGING_PRODUCTION_ORIGINS | productionOrigins | Array JSON con todos los orígenes reales productivos, incluido dominio personalizado si existe |
| STAGING_ISOLATION_CONFIRMED | ownerConfirmedIsolation | `true` solo después de verificar aislamiento |

Todos los campos `externalEffects` deben ser `false`. Las URLs/refs `.test` usadas en QA son mocks interceptados; no son recursos provisionados.

## Provisioning local (no frontend)

| Variable | Destino |
|---|---|
| STAGING_CONFIG_FILE | Ruta a JSON revisado, preferiblemente `staging/environment.local.json` |
| STAGING_CONFIRMED_PROJECT_REF | Debe coincidir exactamente con CRM staging para cada operación |
| STAGING_DATABASE_URL | Conexión PostgreSQL **CRM staging**, TLS verificado |
| STAGING_SCHEMA_REVIEWED | `true` para registrar identidad inicial, tras revisar baseline sin datos |
| STAGING_SERVICE_ROLE_KEY | Admin API staging, solo crear usuario ficticio confirmado |
| STAGING_TEST_PASSWORD | Contraseña ficticia 16+ caracteres, no se imprime |
| STAGING_TEST_EMAIL | Solo `*@example.invalid`; default `operador@example.invalid` |
| SUPABASE_ACCESS_TOKEN | Token scoped a CRM staging; no token administrativo global/productivo |
| SUPABASE_CLI | Ejecutable CLI, opcional; default `supabase` |
| STAGING_PE_API_TOKEN | Token nuevo staging, 32+ caracteres; el script no lo expone al browser |
| STAGING_PE_BASE_URL | Debe coincidir con la URL PE revisada |
| STAGING_PE_DATABASE_URL | PostgreSQL **PE staging**, TLS verificado |
| STAGING_CONFIRMED_PE_PROJECT_REF | Debe coincidir con PE staging |
| STAGING_PE_SOURCE | Ruta al Product Engine original incluido en ZIP |
| STAGING_PE_SCHEMA_REVIEWED | `true` tras revisar migraciones PE |
| STAGING_PE_SEEDS_CONFIRMED | `true` tras revisar catálogo/seeds; no datos CRM |

Las conexiones DB admiten host directo `db.<ref>.supabase.co` o pooler Supabase con usuario `postgres.<ref>`. Un DSN arbitrario o de producción se rechaza. Usar certificados adecuados; no desactivar verificación TLS.

## Secrets del proyecto CRM staging (creados por deploy-functions)

`DTG_ENVIRONMENT=staging`, `STAGING_CRM_PROJECT_REF`, `STAGING_PE_ORIGIN`, `PRODUCT_ENGINE_BASE_URL`, `PRODUCT_ENGINE_API_TOKEN`, `PRODUCT_ENGINE_TIMEOUT_MS=4000`.

Supabase proporciona `SUPABASE_URL` y `SUPABASE_ANON_KEY` propios al runtime. No añadir `OPENAI_API_KEY`, claves VAPID, SMTP, WhatsApp ni pagos. Los stubs no usan service-role.

## Servicio PE staging

`DATABASE_URL` apunta a PE staging; `PRODUCT_ENGINE_API_TOKENS` contiene el nuevo token staging (formato del PE: tokens separados por coma); `NODE_ENV=production` activa el comportamiento fail-closed de autenticación, aunque el ambiente comercial sea staging. No usar el script PE local `db:reset` ni `db:rebuild` contra nube.

## Workflow / hosting

- Repository variable `STAGING_BUILD_ENABLED`: default ausente/OFF; poner `true` solo tras configurar GitHub Environment `staging`.
- Environment variable `STAGING_DEPLOYMENT_ENABLED`: default ausente/OFF.
- Environment variable `STAGING_HOSTING_PROJECT_CONFIRMED`: `true` tras verificar proyecto hosting separado, branch staging, build/publish correctos.
- Environment variable `STAGING_DEPLOY_HOOK_ORIGIN`: origen HTTPS exacto aprobado del hook staging.
- Environment secret `STAGING_DEPLOY_HOOK_URL`: hook exclusivo de ese proyecto; nunca el productivo.
- Environment secret `STAGING_SUPABASE_PUBLISHABLE_KEY`: clave pública separada por ambiente (no service-role).

No utilizar secretos de nivel repo con estos nombres si ya existen ligados a producción. Revisar dónde se almacenan: GitHub Environment `staging` debe permitir únicamente la rama `staging`. No se configura Environment production en esta fase.
