# Solicitudes web, CRM y portal de clientes
Actualización: 7 de octubre de 2026.

## Estado real
La bandeja de solicitudes y el portal están publicados. Se verificaron solicitudes, conversión a tickets, historial privado, comentarios, repetición de solicitud y cierre de sesión. **El flujo completo por correo todavía no puede darse por terminado:** Google rechaza la renovación de la conexión existente de martin@956print.com con `unauthorized_client`. Las confirmaciones y notificaciones dependen de esa conexión, aunque se envíen desde hello@956print.com.

No hay un nuevo motor de precios público ni checkout real. El catálogo, carrito y las pantallas antiguas de aprobación/factura continúan como demostración. El portal real está en https://956print.com/account; las pantallas de demostración permanecen bajo /demo.

## Flujo del equipo
1. El cliente cotiza sin crear una cuenta. El formulario guarda datos, referencia y archivos privados.
2. En https://crm.956print.com abrir **Solicitudes web**. Revisar contacto, descripción y referencias.
3. Elegir una ficha existente si coincide el correo, o crear una nueva. Los datos existentes no se sobrescriben. La búsqueda inicial de coincidencias es por correo; todavía no hay búsqueda manual por teléfono o empresa en esta bandeja.
4. **Crear ticket y vincular** crea un trabajo y una entrada de bitácora. La repetición del comando devuelve el mismo ticket. La operación se limita a administradores activos y respeta la visibilidad del ticket.
5. Si corresponde, habilitar el historial para ese correo. La autorización corresponde a la combinación cliente/correo: el portal muestra las solicitudes vinculadas a ambos, incluidas futuras solicitudes revisadas. No expone automáticamente todos los tickets antiguos del cliente.
6. **Incorporar archivos a biblioteca** usa la biblioteca actual del CRM y sus controles de Google Drive. Los archivos privados originales también pueden consultarse desde la solicitud. Los reintentos mantienen claves estables; el primer administrador que inicia una importación conserva su titularidad. Si otro administrador debe retomarla, requiere revisión administrativa del bloqueo, no un cambio automático de propietario.
7. Cambiar seguimiento a Recibido, Trabajando o Terminado. Marcar entregado en el ticket vinculado actualiza la referencia pública a Terminado.
8. Revisar los comentarios en la misma bandeja. Las notificaciones se encolan hacia hello. La respuesta comercial sigue realizándose desde Mail del CRM.

## Experiencia del cliente
- Solicitud inicial sin cuenta y límite existente de cinco archivos / veinte MB combinados: PDF, PNG, JPG y WEBP.
- Correo de confirmación con referencia y resumen, sin precio ni fecha prometidos; objetivo normal de respuesta: un día hábil.
- Acceso a Mi cuenta mediante enlace de un solo uso de quince minutos, sin contraseña.
- Historial de solicitudes revisadas vinculadas al mismo cliente y correo. Descarga de referencias mediante enlaces privados temporales.
- Comentarios sobre un proyecto y **Volver a pedir**, con cantidad/cambios.
- Volver a pedir crea una referencia nueva por revisar, conserva la relación con la anterior y reutiliza referencias. No cobra, no confirma producción y no conserva precios o fechas comerciales anteriores.
- Una sesión ya válida permite consultar el historial aunque Gmail falle. Durante el fallo actual no se generan nuevos enlaces de acceso: se muestra indisponibilidad temporal y se permite seguir cotizando.

## Implementación
Website React/Vite y Worker existente de Cloudflare. Version publicada al cierre: `8c10b7eb-f4f5-4b41-97fa-7c2c6578d6d3`.
Worker: `divine-bird-2f05`. D1: `dtg-website-intake`.
El Worker mantiene la clave de acceso al gateway exclusivamente en servidor.

Supabase proyecto `jpjpnxamiclvhmcywyhx`:
- `website-intake` versión 3: formulario existente, acciones de personal y acciones del portal.
- `integration-worker` versión 16: conserva el código desplegado vigente y agrega diagnóstico de errores OAuth mediante una lista permitida, sin guardar cuerpos del proveedor o credenciales.
- Las funciones conservan su autenticación personalizada. Las acciones de personal verifican JWT real, miembro activo y permisos. Las del portal llegan con la clave privada del Worker.
- Nuevas tablas privadas: `dtg_customer_portal_accounts`, `dtg_customer_portal_tokens`, `dtg_website_comments`.
- Vinculación, estado e importaciones se guardan en `dtg_website_requests`.
- RPCs: `dtg_review_website_request`, `dtg_consume_portal_login`, `dtg_claim_website_import`.
- Trigger de entregado: `dtg_website_delivery_status`.
- RLS de solicitudes vinculadas y comentarios respeta la visibilidad del ticket también frente a consultas directas.

Archivos CRM: `website-requests.js/css`, `index.html`, `supabase/functions/website-intake/operations.ts`.
Archivos web: `src/pages/Account.tsx`, `src/App.tsx`, Header, Footer, `worker.mjs`, `scripts/test-portal-worker.mjs`.

Fuentes SQL aplicadas:
1. `website-intake-schema.sql` — baseline previo.
2. `website-operations-schema.sql` — migración aplicada website_request_operations_and_portal.
3. `website-file-import-schema.sql` — migración aplicada website_file_import_lease.
4. `supabase/migrations/20261007114000_website_requests_ticket_visibility.sql`.

Los tres primeros archivos son fuentes SQL en la raíz del repositorio; no deben confundirse con migraciones nuevas por ejecutar nuevamente en producción. Consultar el historial de migraciones aplicado antes de reproducir un entorno.

## Separación de acceso
No se crean clientes en Supabase Auth. El baseline actual del CRM crea perfiles activos a partir de altas Auth; abrir registro público ahí expondría una frontera de acceso incorrecta. El portal usa cuentas limitadas y hashes de tokens propios.
La cookie de sesión es Secure, HttpOnly, SameSite=Strict, prefijo __Host y siete días. Los tokens sin hash no quedan en tablas ni respuestas públicas. Se retira el fragmento del enlace del navegador tras verificarlo. Desactivar una cuenta revoca su acceso. No se publican notas internas, precios negociados, IDs de ticket ni rutas de archivos en el historial público.
Esto no sustituye una auditoría general del mecanismo de altas del CRM.

## Verificación y limpieza
- TypeScript y build Vite correctos.
- 42 pruebas de integraciones/biblioteca correctas.
- QA de base con PGlite: permisos, conversión idempotente, selección explícita de cliente existente, tokens de un solo uso/expirados, estados de entrega, bloqueo de importación y ocultación de solicitudes vinculadas a tickets no visibles.
- QA del Worker: clave privada, sesión oculta, cookie, origen, rutas, cierre y revocación.
- Prueba HTTP en producción con datos internos: historial propio, rechazo de proyecto ajeno, comentario, repetición idempotente y logout.
- Prueba visual real en CRM: solicitud repetida vinculada al cliente existente, ticket #1416.
- Cuenta interna de prueba desactivada; tokens invalidados; ficha archivada; tickets de prueba #1415 y #1416 cancelados; solicitudes de prueba descartadas. Tres correos de prueba pendientes cancelados para no enviarlos tardíamente. Se preservó la trazabilidad.
- **No se verificó la entrega de correos ni la importación real a Drive con este flujo**, porque ambos requieren restaurar la autorización Google.

## Siguiente paso bloqueado y secuencia de cierre
Revisar la aplicación OAuth usada por el CRM en Google Cloud Console y su autorización por Google Workspace. Se solicitó al propietario abrir esa consola; no se requiere compartir contraseñas o secretos.
No se cambió la cuenta conectada, no se rotaron secretos ni se revocó la conexión existente por suposición. Se probó dar prioridad a los valores guardados en Vault para descartar precedencia de configuración; el rechazo continuó y se restauró el comportamiento original.
Después de resolver la autorización:
1. Verificar renovación del token y sincronización Mail.
2. Enviar una confirmación interna desde hello y comprobar su recepción.
3. Pedir un enlace real de Mi cuenta, abrirlo y comprobar el acceso.
4. Importar un PDF/imagen de prueba a la biblioteca y comprobar un reintento sin duplicado.
5. Piloto con un cliente autorizado y una recompra revisada por Jonathan.
6. Integrar configuración y precios actuales de Product Engine bajo contratos aprobados; nunca copiar la fotografía técnica antigua del plan de investigación ni calcular precios en la web.

