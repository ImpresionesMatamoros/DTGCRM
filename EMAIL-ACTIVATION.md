# Correo desde el CRM — activación pendiente

Implementación y despliegue 2026-10-05. CRM: https://crm.956print.com. Producción Supabase: jpjpnxamiclvhmcywyhx; staging: hhzqmqndavqqswerjhxe.

## Ya disponible

- Migración google_workspace_integration_layer aplicada primero en staging y después en producción.
- Edge Functions integration-api, google-oauth-callback e integration-worker desplegadas. La API valida sesión y miembro activo; callback valida estado de un solo uso y PKCE; worker exige secreto. verify_jwt=false es intencional para esas verificaciones propias.
- Desde ticket → Archivos y correo: redactar, leer correo, vincularlo al ticket y preparar respuesta a un mensaje autorizado. El asunto original se conserva en respuestas para mantener el hilo. Para cambiar asunto usar Preparar correo nuevo.
- Borradores sobreviven a actualización y fallo. Timeout HTTP de texto 20s; cerrar el panel cancela las llamadas. El envío explícito registra una operación duradera cifrada e idempotente.
- Estado queued no significa enviado. done significa procesado/aceptado por Gmail, no leído ni necesariamente entregado al destinatario. Los resultados inciertos se reconcilian antes de otro POST.
- Diagnóstico admin muestra nombres de configuración faltante sin valores. Activación bloqueada si backend incompleto o Google sin conectar.

## Falta configurar Google, no Workspace DNS

1. En un proyecto propio de Google Cloud habilitar Gmail API y Drive API. Crear cliente OAuth tipo Aplicación web. La pantalla de consentimiento debe permitir al usuario Workspace que conectará la cuenta (Interno si el proyecto pertenece a la organización correspondiente; si es Externo en pruebas, añadir ese usuario como test user).
2. URI exacta autorizada para producción:
   https://jpjpnxamiclvhmcywyhx.supabase.co/functions/v1/google-oauth-callback
   Para staging usar otro cliente y:
   https://hhzqmqndavqqswerjhxe.supabase.co/functions/v1/google-oauth-callback
3. En Supabase → Edge Functions → Secrets del proyecto correspondiente guardar:
   - GOOGLE_CLIENT_ID: identificador del cliente OAuth.
   - GOOGLE_CLIENT_SECRET: secreto del cliente OAuth.
   - GOOGLE_REDIRECT_URI: callback exacto anterior.
   - INTEGRATION_ENCRYPTION_KEY: 32 bytes aleatorios codificados base64url. No rotar/reemplazar sin migrar los valores cifrados.
   - INTEGRATION_WORKER_SECRET: otro secreto aleatorio independiente.
   - CRM_ORIGIN: https://crm.956print.com. Si se requieren dos orígenes, CRM_ORIGINS acepta lista separada por comas y tiene prioridad. Sin override, solo se admiten los dos orígenes aprobados: crm.956print.com e impresionesmatamoros.github.io.
   No poner secretos en Git, HTML, capturas o chat. Las claves internas Supabase las suministra el entorno de Edge Functions.
4. En el CRM, como admin, abrir Archivos y correo → Conectar Google Workspace → Autorizar Google Workspace. Autorizar con la cuenta real @956print.com y volver a Actualizar. Esto concede al backend acceso a leer/enviar correo, comprobar send-as y administrar archivos propios de Drive. No utiliza la conexión Gmail de ChatGPT.
5. Validar aliases; solo los aceptados por Gmail pueden enviar. Asignar permisos de bandeja a miembros según necesidad. No se asume que todos los aliases ya existan.
6. Preparar scheduler: habilitar pg_cron y pg_net. Crear en Vault dtg_workspace_project_url con URL del proyecto y dtg_workspace_worker_secret con el mismo secreto del worker. Ejecutar supabase/ops/enable_workspace_worker.sql como propietario. El SQL no incrusta secretos y evita llamadas si configuración OFF o Google desconectado. Una operación por minuto inicialmente. Es un script preparado, todavía no ejecutado ni validado con cron real.
7. Activar Integraciones desde Configuración en el panel. Probar un correo explícito a una dirección controlada por el propietario, consultar Operaciones, responder desde fuera, sincronizar, leer y vincular al ticket. Ningún correo real se envió durante este despliegue.

## Validación y límites

25 tests backend/PostgreSQL aprobados; UI Chromium 320/390/768/1280px aprobada, incluidos respuesta editable y timeout con borrador conservado; APP-STARTUP-QA y CLIENT-FORMS-QA aprobadas. En producción: CORS aprobado para CRM y rechazado para origen ajeno; API y worker sin credenciales devuelven 401; callback con estado inválido 403. Tablas dtg con RLS; anon/authenticated no leen secretos ni insertan jobs; enabled=false, cero conexiones Google y cero jobs al verificar.

Google OAuth, envío/recepción real y cron siguen pendientes. Sin credenciales de CLI Supabase ni herramienta para establecer Secrets, no se pudieron configurar remotamente. No se solicitaron contraseñas ni se habilitaron envíos sin autorización.

Los advisors identifican tablas privadas jobs/private sin policies: denegación intencional para clientes con acceso solo service_role ([explicación](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy)). Producción presenta advertencias previas en funciones core y anonymous sign-ins; las nuevas políticas exigen miembro activo además de authenticated. No se modificaron esos componentes fuera de alcance.

Historia de migraciones: connector asignó producción 20261005094342 a google_workspace_integration_layer y 20261005091500 a client_request_forms; los archivos locales conservan versiones originales 20261005020449 y 20261005041144. Antes de db push reconciliar con migration repair; no repetir CREATE TABLE. Staging tiene versiones asignadas propias.

Rollback: desactivar configuración y cron.unschedule('dtg-workspace-worker'); conservar datos y tokens cifrados. Desconectar Google elimina credenciales locales; la revocación en Google es un paso separado. Los permisos de archivos existentes requieren revocación explícita.

Fuentes: [Scheduler Supabase](https://supabase.com/docs/guides/functions/schedule-functions), [Hilos Gmail](https://developers.google.com/workspace/gmail/api/guides/threads).
