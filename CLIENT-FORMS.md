# Formularios de cliente vinculados al ticket

Baseline: `main`, `f6eac85`, APP_VERSION 0.26.0. Delta aditivo, sin IA.

## Flujo implementado

En la cabecera del ticket, **Formularios para el cliente** abre el panel. El equipo escribe título e instrucciones, selecciona campos y elige vigencia de 7, 14 o 30 días. Los valores iniciales sirven como solicitud simple de información del pedido. No hay un diseñador de formularios paralelo.

**Crear enlace** produce `client-form.html#<token>`, en el mismo directorio/origen que el CRM. Se copia manualmente o se pasa con **Preparar correo con enlace** al composer existente de la Integration Layer. Esa acción solo prellena un borrador editable: nunca envía correo.

El cliente responde sin cuenta del CRM. Puede dejar campos vacíos, pero debe completar al menos uno. Cada solicitud recibe una sola respuesta. El panel del ticket muestra respuestas, fechas y estado derivado: Pendiente, Respondida, Revisada, Vencida o Revocada. **Actualizar respuestas** hace una consulta acotada a ese ticket. **Marcar revisada** registra la acción humana; no cambia productos, cliente, fechas operativas, precios, pagos, tareas ni producción. Para corregir una respuesta se crea una nueva solicitud. No hay sobrescritura de una respuesta recibida.

## Acceso y almacenamiento

- Una tabla `client_form_requests` es la fuente de verdad de solicitud y respuesta. No se copian automáticamente las respuestas a notas, chat o clientes.
- Token de 32 bytes criptográficos, emitido por el navegador; Postgres almacena únicamente SHA-256. El token viaja como fragmento del enlace, y como argumento HTTPS del RPC; no como parámetro HTTP de la página. La página pública usa `no-referrer` y no restaura sesiones del CRM.
- El enlace es una capacidad: quien lo recibe puede responder esa solicitud. No concede acceso al ticket ni a ninguna tabla del CRM. El equipo debe compartirlo con el destinatario adecuado.
- `client_form_get` devuelve solo título, instrucciones y campos seleccionados. Después de responder, no devuelve el contenido de la respuesta.
- RLS del panel exige miembro activo y `ticket_is_visible_to_me`. Ni anon ni authenticated pueden insertar, modificar o borrar filas directamente. La columna `token_hash` no es legible por authenticated.
- Los RPC administrativos comprueban identidad y visibilidad del ticket. Todos usan `search_path=''` y grants explícitos. Los RPC públicos solo aceptan el token de la solicitud; no aceptan un ticket destino.
- Servidor valida lista blanca, tipos, tamaño total (16 KB), campos (2,000 caracteres), email, cantidad (1–1,000,000) y fecha. Los textos se renderizan escapados.
- Creación reintentada conserva id y token. Respuesta reintentada conserva submission id. La fila se bloquea durante el envío; una segunda identidad no reemplaza una respuesta existente.
- Al cambiar/cerrar sesión se cierra el panel y se limpian enlaces/borradores pendientes en memoria. Una respuesta tardía de la cuenta anterior no repuebla ese cache.

## Supuestos y límites explícitos

Los enlaces sin enviar se conservan solo en memoria de la sesión. Tras recargar, **Renovar enlace (invalida el anterior)** permite obtener otro token y extiende la vigencia 7 días. No se guarda el token recuperable en localStorage ni en una segunda tabla. No se renuevan solicitudes ya respondidas o revocadas.

No hay subida pública de archivos en este delta: el baseline no tiene un uploader público con autenticación por solicitud, cuotas y vínculo auditado a File Engine. Dar acceso anónimo al bucket existente o heredar `ticket-files` no sería una implementación segura. El cliente puede describir los archivos en comentarios; un uploader posterior debe registrar un original en el File Engine existente, con límites en servidor y sin permisos públicos sobre Drive.

No hay notificaciones automáticas, autosync de campos, ni correo automático al responder. El equipo consulta la respuesta desde el ticket. La lista muestra las últimas 50 solicitudes; paginación adicional queda pendiente si el uso real la requiere.

La revisión de campos es manual usando los editores existentes del ticket. Este delta no incluye un botón para aplicar automáticamente una respuesta a los campos operativos.

## Activación y reversa

1. Revisar en staging las definiciones reales de `is_active_member`, `ticket_is_visible_to_me` y las políticas de tickets. Las pruebas locales usan fixtures representativos.
2. Aplicar `20261005041144_client_request_forms.sql`. Los formularios pueden activarse sin desplegar Gmail/Drive y sin IA. Ejecutar `supabase/tests/client_forms_permissions_qa.sql` (BEGIN/ROLLBACK) y comprobar aislamiento con dos usuarios reales.
3. Publicar juntos `index.html`, `client-form.html`, `client-form-start.js`, `client-forms.js`, `client-forms.css` y `dtg-public-config.js` en el hosting actual. `node sync-public-config.cjs --check` verifica que la configuración pública generada coincide con la del CRM. No contiene secretos de backend.
4. Probar un enlace HTTPS externo, respuesta real y revocación en staging antes de usarlo con clientes. No hace falta apuntar un dominio al agente: el archivo público vive en el hosting del CRM.
5. Reversa: volver al HTML anterior o retirar el control del panel y revocar enlaces vigentes con acceso administrativo. Conservar la tabla/respuestas. La reversa de UI sola no revoca enlaces ya compartidos. No borrar datos ni usar DROP CASCADE.

Para el correo/Drive, seguir `INTEGRATION-LAYER.md`: OAuth, secretos backend, funciones, permisos y worker son independientes. Tener Gmail conectado a ChatGPT no conecta automáticamente el CRM.

## Pruebas reproducibles

`CLIENT-FORMS-QA.cjs`: Chromium, HTML y scripts reales, backend simulado. Prueba entrada del ticket privado, creación con respuesta perdida, enlace, borrador editable en composer real, envío deshabilitado sin integración, respuestas escapadas, revisión/revocación, backend ausente, reset de sesión, formulario móvil a 390 px, pérdida de red, transporte colgado con timeout acelerado, reintento con mismo submission id e invalid token sin RPC.

`CLIENT-FORMS-DB-QA.cjs`: PGlite 0.3.14 (PostgreSQL real embebido), migraciones de integración y formularios juntas, permisos, RLS con usuario autorizado/no autorizado, validación, idempotencia, respuesta inmutable, renovación, revocación, vencimiento y rollback. Los helpers de auth/visibilidad son fixtures; no prueba la configuración de producción.

Dependencias de QA se instalan en una carpeta de trabajo, no como nuevas dependencias de runtime del CRM. Variables: `NODE_PATH` o `PLAYWRIGHT_MODULE`, `CHROME_BIN` y `PGLITE_MODULE`.
