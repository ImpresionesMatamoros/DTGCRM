# DTG CRM — arquitectura STAGING

## Una base de código, infraestructura separada

```text
ImpresionesMatamoros/DTGCRM
  main ────────── GitHub Pages actual ── Supabase CRM PRODUCCIÓN
  staging ─────── hosting STAGING propio
                     │
                     └─ Supabase CRM STAGING
                          ├─ Auth: usuarios ficticios confirmados
                          ├─ DB: esquema revisado + fixtures nuevos
                          ├─ Storage: buckets vacíos con RLS
                          ├─ Realtime: eventos internos de pruebas
                          ├─ push-fanout: stub OFF
                          ├─ transcribe-chat-audio: stub OFF
                          └─ product-engine-proxy (STEP 10)
                                └─ Product Engine STAGING por HTTPS
                                     └─ Supabase PE STAGING (DB distinta)
```

No se crea otro repositorio CRM. El código PE entregado se incluye como fuente de referencia en el ZIP, separado del CRM, con su lockfile original. No se reimplementa su motor ni su contrato.

## Código integrado

STEP 10 del ZIP se aplicó con merge de tres vías sobre `d5b2354`; el único conflicto fue al final de `index.html` y se conservó la implementación vigente de clientes y buscador. Se mantienen carga inicial paralela, memoria de fotos por render y UX actual. Se incorporan el picker, el proxy, los snapshots, la migración y las pruebas STEP 10 originales; las importaciones de pruebas se hicieron portables a Windows mediante file URLs.

## Configuración y aislamiento

- `environment.js` versionado viene sin destino válido; la app se detiene antes de crear cliente Auth/DB.
- `staging/environment.example.json` tiene placeholders explícitos. `build.cjs` valida la configuración y genera `dist/staging`.
- Se requiere confirmación del propietario de que origen, IDs, claves y PE son independientes. Se rechazan los cinco refs existentes inventariados, URLs productivas conocidas, misma DB para CRM/PE y claves secretas en frontend.
- Se exige HTTPS y un origen separado para app, CRM y PE. El navegador solo permite conexiones al origen local y al Supabase CRM staging aprobado; el PE se consulta mediante el proxy, no directamente.
- UI `DTG CRM — STAGING`, título y manifest distintos. Service worker generado inerte; no se registra push ni se pide permiso.
- CSP limita conectividad, imágenes/medios y formularios. Guard bloquea fetch/XHR/WebSocket/beacon y contactos externos. Fuentes/CDN de librerías se permiten como recursos estáticos, sin credenciales.
- El origen web distinto separa localStorage, sesiones recordadas, BroadcastChannel y service workers del CRM real. No alojar bajo el mismo origen de producción, aunque cambie la ruta.

## Defensa backend

`deploy-functions.cjs` no usa una vinculación Supabase local implícita: cada comando lleva el ref staging validado. Instala secretos nuevos antes de desplegar, copia solamente el proxy STEP 10 y dos stubs sin llamadas externas. No despliega las implementaciones emisoras de producción.

El proxy exige ambiente staging, URL/ref CRM concordantes y origen PE concordante. Verifica JWT y miembro activo usando Auth del proyecto staging. El token PE permanece en secrets del servidor. El timeout y fallback manual STEP 10 se conservan.

El preflight DB exige identidad staging, esquema completo, cero suscripciones push, cero Vault secrets y cero cron activo/trigger emisor detectado. El propietario debe revisar además hooks de Auth, Database Webhooks, SMTP y extensiones en Dashboard: ninguna comprobación de código puede acreditar ajustes remotos aún no configurados.

## Datos y catálogo

Clientes, tickets, notas, usuarios y archivos son ficticios o nuevos. Nada se clona automáticamente de producción. `fixtures.sql` crea una ficha, ticket y producto manual; no crea un falso snapshot PE. El catálogo PE se provisiona desde migraciones/seeds revisados del paquete, y se completan los productos comerciales autorizados sin exportar CRM.

Precio maestro PE y precio vendido CRM siguen separados. No hay backfill de productos antiguos ni recalculo automático. La prueba $45/$40/$50 requiere una referencia autorizada **en PE staging**, explícitamente identificada; un fixture manual $45 no demuestra ese caso.

## Deployment y promoción

Push/PR a `staging`: validación automática. Push a `staging` con `STAGING_BUILD_ENABLED=true`: artefacto validado, usando GitHub Environment `staging`. Deploy hook opcional de un hosting dedicado, desactivado por defecto. El hook solicita publicación; readiness se confirma con smoke tests, no por el 200 del hook.

No hay workflow nuevo para `main`, permisos de Pages ni cambios en producción. `feature/* → staging → pruebas → main` es el flujo futuro. La promoción exige preparar explícitamente configuración productiva y migraciones en una fase autorizada; no se debe copiar este `environment.js` staging directamente sobre producción ni promover datos de pruebas.

Los proyectos y URLs staging todavía no existen/verifican. Arquitectura y tooling preparados; infraestructura pendiente del propietario.
