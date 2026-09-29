# Conversaciones de ticket

Baseline: f23799564b95f4f4c324cc9fce6cfb8a769b72ae.

Se extiende chat_conversations con kind (direct/ticket) y ticket_id único para kind=ticket. Las conversaciones directas mantienen IDs y miembros. Equipo continúa usando conversation_id NULL por compatibilidad. Todos los mensajes, respuestas, hilos, reacciones, referencias y audios siguen en team_posts. No hay backfill ni borrado de mensajes.

La conversación se crea al primer envío, con índice único y recuperación ante altas simultáneas. Sus mensajes llevan conversation_id; ticket_id en team_posts conserva el significado histórico de vínculo desde Equipo. La navegación resuelve el ticket por la conversación. Las notas documentales y bitácora permanecen separadas, accesibles en actividad del ticket; /nota continúa funcionando.

RLS de chat_conversations para ticket delega a ticket_is_visible_to_me. team_posts y storage/chat-private delegan a esa conversación visible. Las reacciones/reminders ya consultan team_posts bajo RLS. No se relajan las reglas de DM. Las fotos/archivos nuevos usan carpeta de conversación en bucket privado, nunca ticket-files para una conversación privada. El RPC de push filtra destinatarios por acceso al ticket.

SQL exacto: supabase/migrations/20260929132928_ticket_context.sql. Agrega dos columnas de conversación y tres de archivo a mensajes; flexibiliza miembros NULL solo para kind=ticket mediante constraint discriminado. Reemplaza políticas existentes por condiciones equivalentes para DM y condiciones de acceso al ticket para el nuevo tipo. No cambia secretos ni agrega tablas de mensajes.

Producto→tarea utiliza tareas existente, ticket_id y productId en action_path JSON v1 ya soportado por KDS. El selector se precarga desde el producto y el núcleo valida pertenencia al ticket. Una tarea no cierra ticket. No se generan tareas al crear productos.

Backend de transcripción existente: este cambio respeta su contrato. No se asume que proveedor/secreto o push-fanout estén configurados. Audio válido aun si falla transcripción. La migración no crea ni modifica credenciales.

Estado de activación: SQL preparado, NO aplicado. La revisión automática bloqueó esta migración por falta de autorización específica. fetchAstraConversations comprueba las columnas nuevas y conserva el flujo anterior si no existen; TICKET_CHAT_AVAILABLE evita usar el nuevo compositor antes de activar el backend. Pruebas RLS y almacenamiento pendientes.
