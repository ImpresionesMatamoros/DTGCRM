# Entrega de sesión — formularios, correo y Drive

Fecha del usuario: 4 de octubre de 2026, America/Matamoros.
Baseline: ImpresionesMatamoros/DTGCRM, main f6eac85, APP_VERSION 0.26.0. Rama local: feat/client-request-forms.

## Resultado

Formularios vinculados a tickets implementados y verificados localmente. La rama del equipo de integraciones origin/feat/google-workspace-integrations (20311a0) se incorporó mediante merge local, conservando su implementación Gmail/Drive, su File Engine y su cola durable. No se construyó una segunda integración. El enlace del formulario prellena su composer existente.

No está publicado ni activado en producción. No se modificó main remoto, DNS, Workspace, permisos de Google, ni datos de clientes. No se enviaron correos reales ni se transfirieron archivos reales a Drive. La IA quedó pendiente por la nueva prioridad del propietario.

## Implementación propia

- Panel desde cabecera del ticket: título, instrucciones, selección de siete campos, vigencia, enlace para copiar, renovación, revocación, consulta y revisión de respuestas.
- Formulario público móvil sin login, token criptográfico en fragmento, respuesta única, validación servidor y confirmación.
- SHA-256 del token en Postgres; RLS del ticket para personal; anon no lee tablas. No exposición del ticket, notas privadas, pagos o contactos internos.
- Creación y respuesta idempotentes. Reintentos no sobrescriben respuestas anteriores ni confirman cambios que no se guardaron. Timeouts mantienen los campos editables.
- Limpieza de panel/enlaces al cambiar sesión; resultados tardíos no reponen cache de otra cuenta.
- Handoff al composer de correo existente, como borrador editable. Envío deshabilitado sin configuración habilitada y alias verificado. Los errores desconocidos del backend se muestran de forma amable.
- Documentación de activación, reversa y limitaciones en CLIENT-FORMS.md y actualización de INTEGRATION-LAYER.md. Configuración pública generada y comprobada desde index.html, sin llaves privadas.

## Trabajo reutilizado del equipo de integraciones

Backend integration-api, google-oauth-callback e integration-worker; adapter Gmail/Drive; configuración desactivada; permisos por bandeja; outbox con idempotencia/reconciliación; registro de originales y versiones; upload resumible; relación de archivos con ticket/cliente; acceso privado; aprobaciones por versión y uso. Se conservan sus contratos y pruebas. Son capacidades preparadas en código, no servicios confirmados en producción.

## Pruebas

32 suites CJS ejecutadas: **24 pasaron y 8 fallaron también en f6eac85 sin modificar**. Cero regresiones nuevas detectadas en esa comparación. Se repitieron las suites afectadas por dependencias de entorno con el SDK Supabase fijado 2.45.4 y el Chrome instalado; sus assertions no se cambiaron.

Además: **22 tests de integración/backend/PostgreSQL pasaron**, y la suite browser de integraciones pasó a 320, 390, 768 y 1280 px.

Las dos suites nuevas de formularios están incluidas en las 32: Chromium con HTML real y backend simulado; PostgreSQL embebido PGlite 0.3.14 con ambas migraciones. Prueban tickets privados, whitelists, roles, grants, validación, idempotencia, vencimiento, renovación, revocación, respuesta inmutable, reset de sesión, handoff de correo y error/timeout con campos conservados. El QA SQL de permisos ejecuta BEGIN/ROLLBACK.

APP-STARTUP-QA confirma que permanecen las 21 lecturas originales, en paralelo; los paneles no agregan consultas al arranque. sync-public-config --check y git diff --check pasaron. Después de los últimos ajustes se repitieron las suites de formularios, integración UI y arranque pertinentes.

Fallos previos reproducidos:

- ASTRA-02-QA.cjs: Referencia a renderWorkOrdersPanel inexistente.
- ASTRA-03-QA.cjs: Timeout esperando .ops-progressive.
- ASTRA-03-DOM-QA.cjs: Referencia a renderWorkOrdersPanel inexistente.
- CAT-MAP-QA.cjs: Assertion de lectura/cantidad: 18 vs 1.
- CHAT-WHATSAPP-QA.cjs: Tipo de notificación: null vs respuesta.
- KANBAN-WORKSPACE-QA.cjs: Assertion de lectura/cantidad: 18 vs 1.
- TASKS-SIMPLE-QA.cjs: Texto esperado distinto: ORDENAR EN LINEA vs ORDENAR A MONTERREY.
- TICKET-UX-QA.cjs: Fixture no encuentra .ticket-products.

## Migraciones y Edge Functions

Nueva propia: supabase/migrations/20261005041144_client_request_forms.sql. Incluye client_form_requests y RPC client_form_create, client_form_get, client_form_submit y client_form_manage. QA SQL: supabase/tests/client_forms_permissions_qa.sql.

Reutilizada por merge: supabase/migrations/20261005020449_google_workspace_integration_layer.sql. Funciones reutilizadas: integration-api, google-oauth-callback, integration-worker, y _shared/integrations. No se desplegaron funciones ni migraciones en esta sesión.

## Bloqueos y límites reales

1. Publicación del HTML y aplicación de migración de formularios en staging/hosting actual pendientes. Los enlaces generados localmente no son enlaces operativos para clientes externos.
2. Correo/Drive requieren Google Cloud OAuth, consent, aliases/send-as, secretos backend, funciones desplegadas y scheduler del worker. Tener Workspace o el conector de ChatGPT conectado no sustituye esta configuración del CRM. No se verificó acceso de despliegue al proyecto Supabase.
3. Subida de archivos desde el formulario público pendiente: no hay bridge auditado de token público a upload autenticado/File Engine. No se abrió ticket-files ni Drive al público como atajo.
4. Respuestas se revisan dentro del panel del ticket; campos se actualizan manualmente con los editores existentes. No hay autoaplicación ni notificación automática al responder.
5. Enlace se conserva solo en memoria; tras recarga se renueva, invalidando el anterior. Cada solicitud admite una respuesta. Lista acotada a 50 solicitudes.
6. No se verificó OAuth real, entrega Gmail, permisos Drive reales, uploads reales de 500 MiB, browser móvil físico, RLS de producción, ni Deno check nuevo en esta sesión. Las pruebas de transferencias grandes son simuladas y acotadas.

## Archivos propios tocados

index.html; client-forms.js; client-forms.css; client-form.html; client-form-start.js; dtg-public-config.js; sync-public-config.cjs; CLIENT-FORMS-QA.cjs; CLIENT-FORMS-DB-QA.cjs; CLIENT-FORMS.md; SESSION-HANDOFF.md; supabase/migrations/20261005041144_client_request_forms.sql; supabase/tests/client_forms_permissions_qa.sql. Adaptaciones al trabajo del otro equipo: integrations.js e INTEGRATION-LAYER.md. Los otros 23 archivos de integración se incorporaron desde su commit, sin atribuirlos como desarrollo propio.

## Siguiente paso en el orden aprobado

Aplicar y publicar formularios en staging; probar dos roles y un cliente externo; después configurar y validar correo, luego Drive con originales/versiones y permisos reales. La IA sigue al final. Ver CLIENT-FORMS.md para la reversa sin borrado de respuestas y INTEGRATION-LAYER.md para el rollout de Google.
