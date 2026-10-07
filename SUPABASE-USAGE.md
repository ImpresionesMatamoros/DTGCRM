# Library and usage update — 2026-10-06

CLIENT-LIBRARY.md documents the new direct Google original transfers, private96px/320px derivatives, targeted task refreshes and five-minute idle mail synchronization. Existing reduced chat/ticket photos remain in Storage. Cron still checks eachminute, and due work remains prompt. Baseline request counts do not prove byte attribution; validate billed egress and log ingest after a representative pilot. No measured production saving percentage is claimed.

# Reparación de consumo de Supabase — 3 de octubre de 2026

El CRM descargaba sus 21 fuentes de datos ante cada evento de Realtime. La bitácora tiene 1,319 filas (aproximadamente 363 KB de JSON sin compresión), por lo que su descarga necesita dos páginas. También se consultaban recibos de lectura cada 10 segundos con el chat cerrado y se firmaba el mismo avatar varias veces durante renders simultáneos.

## Cambios

- Los eventos actualizan las tablas afectadas y reutilizan snapshots en memoria de las tablas suscritas que no cambiaron. Las fuentes sin suscripción y los tickets se consultan siempre. Si cambia la lista visible de tickets o su visibilidad, se reconcilian todas las tablas: una pérdida de acceso puede hacer que Realtime deje de entregar eventos del ticket. No hay caché persistente de datos ni cambios al service worker.
- Los eventos próximos se agrupan durante un segundo, con una ventana fija para evitar posponer indefinidamente la actualización. Las actualizaciones que llegan durante una consulta se conservan para otra pasada; una recarga completa tiene prioridad.
- Los cambios ordinarios de tickets conservan la recarga selectiva solamente si el evento es UPDATE, existe un snapshot de la sesión y su visibilidad coincide. Inserciones, eliminaciones, cambios de visibilidad, perfiles y estados desconocidos mantienen la reconciliación completa. También se compara ticket_access, consultada en cada pasada, para detectar cambios de permisos aunque esa tabla no esté publicada en Realtime.
- Si un canal falla, el sondeo actualiza los canales afectados. Reconexión, cambio de visibilidad del navegador, acciones locales y actualización manual siguen teniendo reconciliación completa.
- Los recibos se consultan solamente con una conversación montada y la pestaña visible, solamente para mensajes renderizados. El sondeo es cada 30 segundos; eventos de lectura se agrupan durante un segundo. Cambiar conversación permite una consulta inmediata. Los errores también respetan el intervalo.
- Las imágenes comparten una solicitud de firma por bucket y ruta. Las URLs se reutilizan durante 55 minutos y se renuevan antes de su vencimiento de una hora. Las solicitudes y respuestas de una cuenta anterior se descartan.

## Verificación

SUPABASE-USAGE-QA.cjs prueba en Chromium: carga completa, reducción de 21 a 8 consultas en un refresh de chat, notas de clientes, cambios de acceso, visibilidad de tickets, combinación de refreshes, aislamiento de cuentas, 30 firmas simultáneas reducidas a una, vencimiento y recuperación de errores, y recibos con conversación cerrada/abierta, cambio de scope y agrupación de eventos.

También pasan APP-STARTUP-QA, DEVICE-ACCOUNTS-QA (SDK real 2.45.4), CHAT-INBOX-QA, CHAT-AUDIO-QA, CLIENTS-WORKSPACE-QA y ASTRA-QA. CHAT-WHATSAPP-QA falla en una expectativa de clasificación de respuesta (`null` frente a `respuesta`); el mismo fallo aparece en el commit original d5b2354 sin esta reparación.

## Cómo evaluar el ahorro

El 62% menos de consultas corresponde al escenario de refresh de chat del fixture, no a una reducción garantizada de egress o Logs Ingest facturados. Los registros consultados no incluyen bytes de respuesta por endpoint. La optimización reduce nuevas llamadas y descargas; el consumo acumulado del ciclo no se borra.

Comparar días completos con actividad similar en Usage, filtrando DesignToGoCRM y separando DTG CRM STAGING. Con cuotas de 1 GB de ingest y 5 GB de egress sin caché, una meta con margen para meses de 31 días es 25 MB/día de ingest y 130 MB/día de egress. Cached Egress tiene su propia cuota. Revisar la tendencia durante varios días.

No se cambió logging de Postgres: ya tenía log_connections y log_disconnections apagados, log_statement=ddl, log_min_duration_statement=-1, log_min_messages=warning y pgaudit.log=none. No se eliminó historial ni se redujeron permisos para ahorrar tráfico.
