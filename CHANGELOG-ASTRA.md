BASELINE:
commit: 8d063d70e45ac84f97ca8cfb7304e8a78789844b
archivos inspeccionados: index.html, sw.js, README.md (vacío); JavaScript externo @supabase/supabase-js 2.45.4 (UMD de CDN); esquema y políticas de producción mediante consultas de solo lectura.

# CHANGELOG — Astra

## Estado de esta entrega

Integración sobre `main` 8d063d7 en una rama de trabajo. Migración `20260929003414_astra_team_conversations_privacy` aplicada en DesignToGoCRM; HTML y Edge Function sin desplegar. `index.html` es el único archivo del repositorio que contiene JavaScript de la aplicación. `sw.js` permanece idéntico al baseline. Los archivos nuevos son aditivos y requieren integración deliberada.

## Modificado: index.html

- Chats 1 a 1 sobre `team_posts`, con `chat_conversations` y filtrado servidor mediante la migración adjunta. El chat Equipo conserva su línea de tiempo y el Realtime existente de `team_posts`.
- Referencias seleccionables `@` de personas/clientes y `#` de tickets; se guardan como JSON con ID, tipo, texto y posición. Clientes y tickets son enlaces navegables; cliente no genera mención.
- Respuesta directa (`reply_to_id`), hilos (`thread_root_id`) y apertura desde mensajes y vínculos de ticket. Las respuestas nuevas al hilo vinculado se leen desde las mismas filas.
- Selección múltiple de mensajes; enlace de mensajes individuales o del hilo del equipo a ticket. Los mensajes personales no se vinculan completos ni se colocan en `ticket-files`.
- Pantalla de revisión para crear ticket, tarea y seguimiento. Reutiliza `createTicketCore` y `addTareaCore`; un seguimiento usa el área Planeación. Los datos no se guardan al detectarlos: la persona confirma el ticket, texto, fecha y responsable. Una nota de bitácora conserva una fotografía del origen.
- Grabación de audio con MediaRecorder y MIME negociado; subida al bucket privado y reproducción desde URL firmada; estado de transcripción, transcripción visible/copiar y búsqueda textual. La transcripción depende de la función separada.
- `Para después`: guardados, próximos, vencidos, completados y archivados en filas privadas; aviso de vencimiento en la app abierta, posponer una hora y convertir en seguimiento.
- El folio escrito en un mensaje del equipo deja de crear una asociación implícita cuando la nueva migración está disponible. Una relación con ticket pasa por la acción explícita. Sin la migración conserva el comportamiento anterior.

## Nuevos

- `ASTRA-01-communications.sql`: modelo, RLS, integridad y bucket privado. **Aplicado en Supabase el 29 de septiembre de 2026 UTC.**
- `supabase/functions/transcribe-chat-audio/index.ts`: transcripción bajo JWT de usuario y clave de proveedor en secreto del servidor. **No desplegada.**
- `ASTRA-QA.cjs`: pruebas aisladas de funciones puras sin conexión a producción.
- `INTEGRATION-NOTES-ASTRA.md`: auditoría, límites y secuencia de integración.
- `ASTRA-against-8d063d7.patch` (archivo de auditoría externo al commit): diff reproducible frente al nuevo SHA del baseline.

## Restricciones deliberadas

No se añadieron frameworks, tablas de tareas paralelas, canales, grupos arbitrarios, bots ni automatización que escriba tickets sin revisión. No se modificó `sw.js` ni se publicaron archivos de la app en producción. El esquema de Supabase sí fue migrado por petición expresa.

## Integración del 29 de septiembre

- Nuevo baseline: `8d063d70e45ac84f97ca8cfb7304e8a78789844b`; el anterior era `d72ddddcb7d4e60068daa7473ed25ff7da3d344b`.
- Se preservaron los 101 renglones modificados por el commit `8d063d7`: corrección del pulso de avisos, destello de mensaje y actualización en sitio de Smart Actions. La aplicación se identifica como `0.25.2` / `2026.09.29.1`.
- El cambio de Astra sigue siendo una entrega parcial con los límites detallados en las notas de integración. Su esquema ya fue aplicado; la Edge Function y el HTML siguen sin desplegarse.

## Migración aplicada en Supabase

- Versión `20260929003414`, nombre `astra_team_conversations_privacy`, proyecto `jpjpnxamiclvhmcywyhx`.
- Antes de aplicar, se cerraron los permisos heredados de las tablas nuevas, se restringió el fan-out de push a los dos participantes de cada DM y se protegió también la edición posterior de mensajes privados.
- Verificación: RLS con autor, destinatario y tercero en transacción revertida; tercero no vio conversación ni mensaje. Las 27 filas previas permanecen intactas y no quedó ninguna fila de prueba.
