# STAGING — runbook

## 0. Estado y decisiones pendientes

Código listo en rama `staging`; no hay recursos remotos staging provisionados. No modificar Pages, `main`, secretos ni proyecto Supabase productivos. No es necesario comprar dominio para la URL de pruebas.

Propietario debe completar:

1. Crear **dos proyectos nuevos**: CRM staging y PE staging, confirmar costos/región y guardar credenciales nuevas.
2. Proporcionar un hosting separado para la app y otro servicio HTTPS para PE; no reutilizar el único sitio Pages productivo.
3. Facilitar/revisar un baseline completo de **esquema sin datos** del CRM actual (pre STEP 10). Git contiene cambios incrementales y no puede reconstruir por sí solo la base inicial.
4. Revisar catálogo/precios staging, nombres comerciales y presentaciones (el cierre STEP 10 reporta presentaciones DRAFT).
5. Configurar GitHub Environment staging, sus variables, secrets y restricciones; no tocar production.

No hay IDs, URLs ni claves staging inventadas en este paquete.

## 1. Checkout y validación local

```sh
git clone https://github.com/ImpresionesMatamoros/DTGCRM.git
cd DTGCRM
git switch staging
pnpm install --frozen-lockfile --ignore-scripts
pnpm exec playwright install chromium
pnpm staging:test
pnpm test:pe
```

Node 24, pnpm 11.19.0. `CHROME_BIN` puede indicar un Chrome local. QA usa mocks/DOM y respuestas grabadas: no se comunica con DB productiva ni acredita staging remoto.

Copiar `staging/environment.example.json` a `staging/environment.local.json`, reemplazar cada placeholder por valores **verificados** y marcar aislamiento solo tras comprobarlo. Añadir todos los dominios reales de producción a productionOrigins.

## 2. Provisión CRM staging

En proyecto vacío: desactivar signups públicos, SMTP custom, SMS/OAuth no necesarios, Auth hooks, Database Webhooks, cron y proveedores de pagos/mensajería. Auth necesita únicamente usuarios ficticios confirmados y login email/password. Configurar Site URL y redirect allowlist solo para el origen staging.

El baseline de esquema debe incluir tablas, tipos, RPCs, constraints, índices, grants/RLS, Storage policies y Realtime del CRM vigente. **No** incluir filas de public, auth.users, auth.sessions, storage.objects, vault ni secrets; tampoco teléfonos, chats, clientes, tickets, archivos ni dump completo. Retirar/desactivar triggers emisores y jobs antes de importar. Conservar `is_active_member`, privacidad de tickets/chat y protección de concurrencia.

Aplicar el baseline solo al proyecto staging mediante una herramienta apuntada explícitamente al proyecto nuevo. No ejecutar `db reset --linked` ni replay ciego de las migraciones históricas: algunas están fuera de la carpeta y las tablas iniciales faltan. Registrar cuáles están ya incluidas en el baseline para una futura reconciliación de historial.

Crear buckets vacíos `ticket-files`, `chat-private`, `profile-avatars` y sus políticas actuales revisadas. No hacer públicos los privados. Comprobar lectura/upload según usuario activo y contexto privado, acceso denegado al usuario no autorizado y anónimo.

Con variables STAGING_* cargadas en la terminal (ver STAGING_VARIABLES):

```sh
node scripts/staging/database.cjs init-identity
node scripts/staging/database.cjs preflight
node scripts/staging/database.cjs apply-step10
node scripts/staging/database.cjs seed
node scripts/staging/create-test-user.cjs
```

`init-identity` exige baseline revisado y sin filas personales/de trabajo. Crea un marcador privado staging. `apply-step10` aplica únicamente la migración entregada, con posible ampliación de precisión de precio en la DB staging. `seed` crea datos ficticios. El usuario se crea confirmado mediante Admin API, sin invitación/email y con nombre ficticio. Si el baseline impone más columnas/defaults, ajustar fixtures **solo en staging** después de revisar el esquema; no inventar un baseline para que las pruebas aparenten pasar.

Después: revisar advisors, grants/RLS, tablas expuestas, triggers, Realtime, buckets y settings del **proyecto staging**. No se ejecutaron consultas SQL contra producción en esta entrega.

## 3. Provisión PE staging

En el ZIP, `product-engine/` es el código STEP 10 recibido, sin reimplementación. Confirmar su origen `e83a6da…`, revisar migraciones y seeds antes de aplicar. Supabase PE staging debe ser una DB separada, no el proyecto CRM. Desactivar su Data API público: el CRM solo debe consumir la API del motor. El adaptador revoca privilegios anon/authenticated/PUBLIC, activa RLS en tablas públicas y restringe default privileges; el servicio PE usa su conexión DB privada. Comprobar advisors y ausencia de acceso público después de migrar.

```sh
node scripts/staging/pe-database.cjs status
node scripts/staging/pe-database.cjs migrate
node scripts/staging/pe-database.cjs seed
```

El adaptador conserva el ledger/checksum del motor y no admite reset. Requiere proyectos/confirmaciones explícitos, proyecto inicialmente vacío o marcador correcto y revisión de seeds. Si SQL usa referencias externas, se detiene para revisión. No reimportar workbooks confidenciales o datos de otro CRM automáticamente. Los seeds de desarrollo no representan necesariamente todo el catálogo comercial publicado; revisar/completar productos autorizados con la consola original.

Arrancar el servicio PE con su `DATABASE_URL` staging y token nuevo. Instalar con lockfile original, `pnpm build` y `pnpm start`, según hosting elegido. API privada por bearer token, HTTPS, sin acceso directo del browser a DB. **Proteger `/admin` mediante acceso privado/autenticado del hosting**: la consola entregada no debe quedar abierta públicamente solo por existir autenticación de la API. No ampliar RBAC ni rediseñar el motor aquí.

Comprobar health y que catálogo/precio sin bearer devuelven 401. Nunca ejecutar herramientas locales destructivas (`db:reset`, `db:rebuild`) contra nube; el PE original además rechaza hosts no locales.

## 4. Proxy y funciones apagadas

```sh
node scripts/staging/deploy-functions.cjs
```

Antes de correr: `supabase secrets set --help` y `supabase functions deploy --help` para verificar CLI instalado. Se instala la configuración staging y token PE por env-file temporal; se deploya `product-engine-proxy` con verificación JWT, más stubs OFF para push y transcripción. No se despliega la implementación real de push-fanout. No imprimir tokens ni activar debug que los exponga.

Probar JWT ausente/revocado, miembro inactivo, ref equivocado, token PE incorrecto, timeout y contrato distinto. Ninguno debe provocar lectura productiva ni envíos externos; la captura manual permanece disponible.

## 5. Artefacto y hosting

```sh
node scripts/staging/build.cjs staging/environment.local.json
```

Publicar **solo `dist/staging/`** en un hosting dedicado, con origen que coincida exactamente con appUrl. No publicar el repo completo, SQL, paquetes, scripts, secretos ni ZIP. El artefacto tiene config pública, CSP, manifest distinto, banner e inert SW. No contiene service-role ni token PE.

El build limpia únicamente el destino dentro de `dist/`. No usa variables productivas como fallback. Configuración vacía detiene la app antes de crear cliente Supabase.

## 6. GitHub Actions preparado

Workflow `.github/workflows/staging.yml` se dispara únicamente con push/PR a staging. Validación corre sin secrets, con fixtures. El job de artefacto está desactivado hasta `STAGING_BUILD_ENABLED=true` a nivel repo y variables/secrets en Environment staging.

Si el propietario elige hosting con deploy hook: crear un proyecto dedicado que tome **branch staging**, ejecutar `node scripts/staging/ci-config.cjs && node scripts/staging/build.cjs`, publicar `dist/staging` y cargar en ese hosting la misma configuración staging. Registrar su hook exclusivo y origen aprobado; activar `STAGING_HOSTING_PROJECT_CONFIRMED` y `STAGING_DEPLOYMENT_ENABLED` solamente después. La respuesta del hook significa solicitud aceptada, no deployment verificado.

No se implementa/activa `push main → production` en esta fase: ya existe Pages productivo y no se altera. La promoción y su configuración necesitan una fase futura explícita. Tampoco hay migración DB automática en cada push: el baseline pendiente exige provisioning revisado.

## 7. Aceptación real STEP 10

Registrar evidencias, IDs ficticios, moneda, requests/responses y filas guardadas (sin secretos). No marcar YES hasta probar en URLs y proyectos staging reales.

1. **Referencia $45:** escoger/autorizar en PE staging un producto cuyo resultado configurado sea 45.00 (o un producto de prueba claramente identificado, no cambiar un maestro productivo). Crear líneas vendidas a 45, 40 y 50. Verificar `pe_total_amount=45` en todas, precio vendido correcto y maestro PE intacto. Modificar después la tarifa staging: históricos permanecen iguales hasta actualización explícita.
2. **QUOTE_ONLY:** producto/configuración real sin tarifa; precio inicial NULL, se puede agregar, luego precio provisional manual, snapshot sigue QUOTE_ONLY y maestro no cambia. Nunca convertir falta de tarifa en cero o inventar un total.
3. **PE caído:** detener solo servicio staging o apuntar solo su proxy a un endpoint staging indisponible. Guardar ticket y producto manual; formulario no se bloquea. Restaurar configuración y comprobar recuperación.
4. **Regresiones:** móvil/PC, descuento/markup, documentos históricos, cambio de cuenta, privacidad, fotografías, búsqueda y carga inicial. Comprobar USD/MXN explícitos y matemática cantidad × unitario.
5. **Efectos OFF:** ticket/chat ficticio no genera WhatsApp, email, push, pago real ni webhook productivo. Revisar logs del proxy/stubs y DB, además de la UI.

## 8. Rollback y entrega

Desactivar deploy hook, mantener Environment staging sin build/deploy y publicar último artefacto staging comprobado si hace falta. No usar force push, no borrar la rama persistente y no revertir producción. No transferir fixtures a main/producción.

Una caída/config incompleta del PE deja el CRM en captura manual según STEP 10. El ZIP es código y documentación, no un backup de datos ni una prueba de infraestructura ya creada.
