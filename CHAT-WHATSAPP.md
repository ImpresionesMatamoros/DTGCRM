# Chat simple: implementación y validación

## Plan ejecutado

1. Limpiar la interfaz: AI Bridge dormido, filtros TODO/MENSAJES/SISTEMA/AI BRIDGE retirados, Para después y búsqueda ocultos en móvil. Menú de cuenta sin reconstruir la pantalla ni saltar al inicio.
2. Simplificar tareas: acción directa desde mensaje y Kanban; descripción y destino iniciales, opciones avanzadas plegadas. Mensaje ya relacionado con ticket: crear y confirmar en dos clics. Sin relación: elegir ticket; no adivinar el destino.
3. Unificar archivos: un botón +, selección múltiple, cola con preview, tamaño y quitar; imagen pegada sin exigir ticket; fotos y documentos en Equipo, DM y conversación del ticket. Máximo 20 archivos por lote/25 MB por archivo. Fallos individuales conservan solo los pendientes; reintentar no repite éxitos. Se reutilizan team_posts y Storage.
4. Mantener conversaciones claras: burbujas propias a la derecha, fechas y agrupación, tarjetas con último mensaje/hora/unread, título del chat personal, borradores separados por conversación/hilo, presionar para menú y deslizar a la derecha para responder. Enviado confirma persistencia; Visto por muestra lectura derivada del estado existente. Sin inventar una confirmación de entrega al dispositivo.
5. Acciones directas: reacción y Enterado explícito con nombres. Adjuntar a ticket consolidado; chip con folio/cliente/trabajo clickeable. Eliminación conserva posición y MENSAJE ELIMINADO, sin texto, imagen, archivo, nombres de archivo ni acciones previas; actualiza realtime.
6. Lectura y avisos: RPC de lectura con permisos del usuario, limitado a conversaciones accesibles; marcar lectura únicamente al ver lo reciente. Visto y Enterado son independientes. Solo DM, mención explícita, respuesta al autor o hilo donde fue mencionado generan aviso. Reacciones, lecturas, borrado y actividad general permanecen silenciosos. Horario America/Chicago 7–18; Martin/Ceci tienen preferencia fuera de horario inicialmente activa. Sin avisos retrospectivos nocturnos; fan-out bloquea la fila y deduplica. Push TTL 60 segundos.
7. Clientes: selector de existentes en creación desde chat por nombre/empresa/teléfono; createTicketCore reutiliza cliente_id seleccionado o coincidencia exacta para todos sus llamadores. No se agrega catálogo paralelo.

## Cambios de servidor aplicados

- Proyecto DesignToGoCRM: migración `20261001044137_chat_whatsapp_core.sql` aplicada.
- `file_size`, `notif_after_hours`, reacción `ack`, política de lectura por scope y RPC `chat_read_receipts`.
- Helpers internos de destinatario/horario y reemplazo compatible de `push_targets_for_post`; ejecución restringida a service_role. Lecturas usan SECURITY INVOKER y RLS.
- Edge Function existente `push-fanout` versión 2 desplegada; conserva webhook con secreto y transporte Web Push existentes. Fuente versionada en `supabase/functions/push-fanout/index.ts`.

## QA ejecutado

`CHAT-WHATSAPP-QA.cjs`: Chromium con handlers y funciones reales, red bloqueada y persistencia simulada. Pasa: PDF/AI/EPS/SVG/PSD/ZIP/DOC/DOCX/XLS/XLSX/TXT/CSV, equipo/DM/ticket, lotes mixtos, 2/10 imágenes, fallo parcial/reintento sin duplicado, eliminación de imagen huérfana ante fallo de insert, clipboard sin ticket, borrados saneados/realtime, nombres de Enterado/lectura, notificaciones/replies/hilos/DST, reutilización de cliente, borradores separados, no marcar leído al estar arriba, swipe/long press y menú móvil dentro de pantalla.

`CHAT-COMPACT-QA.cjs`, `TASKS-SIMPLE-QA.cjs` y `ASTRA-QA.cjs` pasan: limpieza de interfaz desktop/móvil, tareas/guardado/reintento, cuenta móvil conserva scroll, referencias/menciones/hilos/escape HTML.

`supabase/tests/chat_whatsapp_qa.sql` se ejecutó en producción en una transacción con ROLLBACK: roles authenticated con identidades Martin/Ceci/Jonathan/Alexia; aislamiento DM/lecturas, nombres de lector, ack, destinatarios relevantes, general/archivo silencioso, respuestas/hilos, deduplicación de fan-out y límites Chicago verano/invierno. No deja mensajes, archivos, suscripciones ni preferencias de prueba. No se envió push de prueba.

Ejecutar navegador con Playwright disponible: `node CHAT-WHATSAPP-QA.cjs`; `CHROME_BIN` opcional. El QA no necesita credenciales ni escribe datos reales. SQL requiere rol administrador y siempre hace rollback.

## Límites y deuda real

- Se probaron permisos bajo cuatro identidades autenticadas en PostgreSQL; no se iniciaron sesiones interactivas con contraseñas de estas personas.
- Queda validación manual en teléfonos reales de Safari/iOS/Android: picker del sistema, permisos de micrófono/cámara, clipboard del SO y recepción Web Push. Las pruebas Chromium cubren la lógica, no esos permisos externos.
- No se agregan presencia online, escribiendo, llamadas, entrega al dispositivo ni envío offline. Enviado significa guardado en servidor; los borradores en memoria se limpian al cerrar sesión y no sobreviven recarga.
- Advisors mantienen deuda previa de pg_net en public, funciones definer antiguas con permisos amplios, políticas antiguas y protección de contraseñas filtradas desactivada; los nuevos helpers internos no son ejecutables por anon/authenticated. Recomendación de auditoría separada: https://supabase.com/docs/guides/database/database-linter y https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection.

Todos los puntos A–Q del archivo de trabajo tienen implementación; la validación física descrita arriba requiere dispositivos/sesiones del equipo.
