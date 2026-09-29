# Ticket UX — 2026-09-29

BASELINE: f23799564b95f4f4c324cc9fce6cfb8a769b72ae (main).

Inspeccionados: index.html (renderMain, renderTicketHeader, renderComposer, submitNote, addProductoCore, submitOpsEditor, renderOpsProgressive, publishChatMessage, fetchAstraConversations, abrirChatEnMensaje), ops-menu.js/css, sw.js y contratos SQL de conversaciones, mensajes, tickets, tareas y almacenamiento. Se conserva la integración progresiva y la corrección de reconexiones existentes en main.

Cabecera operativa compacta; dinero/documentos en detalle secundario. Productos reales arriba, precio pendiente por producto y panel editable. Crear tarea desde producto utiliza tareas y action_path v1 existentes, fija producto/ticket y no crea tareas automáticamente. Productos nuevos recuperan su ID del servidor. No se asignan archivos o tareas al primer producto por suposición.

Captura de producto con foco inmediato y Enter entre nombre, cantidad y precio; guardado único, valores conservados ante error. Ajustes de viewport móvil, tamaño de campos y desplazamiento; manifest e iconos PWA. Notas y comportamiento histórico preservados cuando falta el backend de conversación.

Conversaciones de ticket implementadas mediante team_posts/chat_conversations compartidos; activación condicionada a presencia de kind y ticket_id. La migración 20260929132928_ticket_context.sql NO fue aplicada: revisión automática rechazó modificar esquema/RLS/storage en producción sin autorización específica para esta migración. No se intentó ejecutar por otra vía. Código de conversación permanece desactivado con el esquema actual. No se desplegaron Edge Functions ni secretos.

Límites: archivos sin relación explícita a producto siguen en contexto del ticket. Push y transcripción dependen de configuración backend existente; no se certifica su operación. No se reclasifican tareas históricas, ni se modifica cobro/cierre/entrega automática. SQL requiere revisión y pruebas RLS antes de activación. Prueba física de teclado móvil, grabación, permisos, zoom, scroll y distribución visual pendiente.
