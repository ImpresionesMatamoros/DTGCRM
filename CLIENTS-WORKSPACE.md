# Clientes y detalles del calendario

Clientes ahora muestra tarjetas con logo, nombre, tickets abiertos y los cuatro tickets más recientes. El orden prioriza la cantidad de tickets abiertos y después la fecha de creación del ticket más reciente; entregados pendientes de pago continúan abiertos hasta su cierre explícito. La búsqueda encuentra nombre, empresa o teléfono.

**Asociar tickets** ofrece búsqueda, lista desplazable, selector de destino y arrastre nativo hacia tarjetas o el destino seleccionado. En móvil también se puede usar el botón Asociar. Antes de reasignar un ticket con cliente se ofrece Eliminar, Fusionar o Dejar como está. Eliminar solo está disponible cuando no quedan otros tickets; retira el cliente de las vistas activas mediante archivo y transfiere sus notas y tareas al destino. No se destruye su historial. Fusionar mueve todos los tickets, notas y tareas, reúne las estrellas y completa contacto/logo faltantes, conservando la identidad del cliente principal. Los documentos ya emitidos mantienen sus datos originales.

La fusión múltiple se inicia en la cabecera, permite seleccionar clientes, elegir el principal y revisar antes de confirmar. La operación es transaccional, con bloqueo de filas y permisos de tickets. La reasignación valida que el cliente previo siga siendo el esperado. Una protección de lectura evita archivar clientes con tickets que el usuario no puede gestionar; ninguna mutación de tickets omite RLS.

Los controles de color y estilo desaparecen de Clientes. Los perfiles incorporan Cliente Frecuente (estrella plateada), Ticket Alto (dorada), logo/contacto, tareas sencillas, notas internas en vivo, galería y todos sus tickets. Las tareas nuevas toman al creador como responsable y su destino predeterminado; cambiar responsable recalcula el destino únicamente al crear. Estas tareas también aparecen en las vistas de Tareas y desaparecen de las vistas activas al terminarlas. Las notas de clientes no generan publicaciones generales ni notificaciones de chat.

En Calendario, Atrasadas y Sin fecha usan el mismo panel desplazable, con miniaturas y arrastre, sin reemplazar el calendario. Reprogramar un ticket que ya tiene fecha conserva la confirmación existente. El mes muestra todos los tickets con scroll independiente por día; la semana y el día seleccionado también permiten recorrer sus entradas. El hover muestra resumen; abrir muestra las fotos y el chat/notas del ticket, junto con las acciones existentes. Las fotos abren el visor de imágenes existente.

## Migraciones aplicadas

- `supabase/migrations/20261002125327_client_workspace.sql`: flags/archivo, notas/tareas de clientes, RPC de asociación y fusión, RLS y Realtime.
- `supabase/migrations/20261002130451_client_workspace_permissions.sql`: permisos explícitos por columna y conservación de notas/tareas al retirar un cliente vacío.

## Validación

- `CLIENTS-WORKSPACE-QA.cjs`: orden, búsqueda, cuatro previews, drag real fuera de la lista y desde perfil, confirmaciones, fusión, estrellas, creación/cierre de tareas y vistas globales, notas, galería, asociación por toque y error sin pérdida de contexto.
- `CALENDAR-DETAILS-QA.cjs`: scroll con rueda entre 16 tickets de un día, hover, fotos/chat, alternancia atrasadas/sin fecha, drag real de atrasado con confirmación y variantes móviles.
- `UNDATED-CALENDAR-QA.cjs`, `MOBILE-APP-QA.cjs`, `TASKS-QA.cjs`, `CHAT-INBOX-QA.cjs`, biblioteca y contexto: regresiones de calendario, arrastre sin fecha, formularios, tareas, chat, fotos, concurrencia y navegación.
- Pruebas de navegador en 320, 390, 768 y 1280/1440 px, sin errores JavaScript ni overflow horizontal.
- `CLIENTS-WORKSPACE-DB-QA.sql`: transacción revertida bajo rol authenticated, asociación, rechazo de cliente previo obsoleto, rechazo de eliminar un cliente con otros tickets, fusión y conservación de flags/notas/tareas, incluido archivo del cliente vacío.

Las tablas nuevas tienen RLS para miembros activos. Notas permite insertar/leer y actualizar solamente `client_id` para fusión. Tareas permite insertar/leer y actualizar sus campos operativos; no se otorgan borrado, truncado ni cambio de autor/fecha de creación. Los RPC no son ejecutables por anon o PUBLIC.

El chequeo de cobertura es una excepción intencional de lectura con SECURITY DEFINER, limitada a miembros activos: debe detectar tickets inaccesibles para impedir que una fusión deje tickets ocultos en un cliente archivado. El asesor señala su ejecución por authenticated ([referencia del chequeo](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable)); esta ejecución es necesaria para la protección. Las escrituras siguen siendo SECURITY INVOKER y sujetas a RLS. Se comprobó también el rechazo de llamadas anónimas e inactivas.
