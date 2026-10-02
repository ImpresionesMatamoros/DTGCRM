# Todos los clientes con ficha

La creación desde algunos flujos de chat/calendario guardaba `tickets.cliente` como texto sin `cliente_id`. La migración repara esos tickets y establece un trigger invoker en INSERT y UPDATE de cliente/cliente_id. Cada ticket con nombre reutiliza una ficha activa por coincidencia de nombre (ignorando mayúsculas y espacios repetidos) o crea una ficha nueva, dentro de la misma transacción. Los tickets sin nombre siguen como pendientes de identificar; no se fabrican clientes ficticios.

La asignación explícita por ID es autoritativa. Cambiar solo el nombre del ticket resuelve la nueva identidad; renombrar una ficha conserva sus asociaciones. Un cliente fusionado redirige a su ficha activa. No se asignan tickets a fichas archivadas sin destino. Si hay varias fichas activas con idéntico nombre, se exige seleccionar una explícitamente; no se fusionan personas por parecido.

Un lock transaccional por nombre evita que dos creaciones automáticas concurrentes fabriquen dos fichas. El constraint `tickets_named_client_has_identity` impide persistir un nombre sin ficha aun si una vía de escritura omite el trigger. La migración conserva el texto y las fechas históricas al reparar asociaciones. No modifica fotos, documentos, precios ni pagos.

Los helpers y el trigger son SECURITY INVOKER con search_path vacío; las escrituras respetan RLS. El resolver requiere un miembro activo para llamadas autenticadas; importaciones con roles de servidor mantienen acceso. El trigger no se expone como RPC. Documentación consultada: [triggers de Supabase](https://supabase.com/docs/guides/database/postgres/triggers).

Resultado del backfill: se vincularon 85 tickets y se crearon 83 fichas, reutilizando la ficha existente para una coincidencia y agrupando un nombre repetido. Pasamos de 27 a 110 fichas activas. No quedan tickets con nombre sin ficha. Los 15 tickets sin nombre continúan pendientes de identificar.

Quick Create ahora envía el cliente_id elegido desde el comienzo, antes de cualquier resolución por texto. `AUTOMATIC-CLIENT-IDENTITY-QA.cjs` valida esta selección; `AUTOMATIC-CLIENT-IDENTITY-QA.sql` comprueba creación, coincidencias por mayúsculas/espacios, edición, protección de desvinculación, renombrado y redirección de IDs fusionados bajo rol authenticated, dentro de una transacción revertida. También pasan las regresiones de Clientes, asociación/fusión, Calendario y navegación contextual. El asesor de seguridad no encuentra incidencias en los nuevos objetos.

También pasan las suites actuales de chat/inbox y touch/tickets. La suite histórica `chat-whatsapp-qa.cjs` falla en su aserción de respuesta antes de llegar a clientes; se reprodujo idéntico fallo restaurando temporalmente la línea anterior, por lo que no lo introduce este cambio. No se alteró el flujo de respuestas en esta corrección.
