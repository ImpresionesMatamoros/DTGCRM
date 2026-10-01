# Calendario de entregas

Fecha de entrega es la fecha principal del ticket y la única que produce una entrada de calendario. Se mantiene la columna histórica fecha_compromiso para conservar las entregas ya programadas. Fecha del evento, entregas parciales y deadlines se guardan como información opcional del ticket; no crean entradas, no se consideran fechas de entrega y no se desplazan automáticamente al reprogramar la entrega. La fecha de atención anterior se conserva como dato histórico. Tener solamente fechas auxiliares equivale a estar Sin fecha de entrega.

## Uso

- Agenda: lista de entregas de los próximos 30 días desde el día seleccionado. En móvil es la vista inicial y presenta una semana compacta; Mostrar mes expande la navegación mensual. Tocar un día abre su lista.
- Mes: escritorio muestra tarjetas por día y acceso al resto mediante +N más. Móvil muestra días y carga de entregas, con la lista del día seleccionado debajo.
- Semana: siete columnas en escritorio, con desplazamiento horizontal dentro de la vista. Móvil presenta siete días accesibles y el trabajo del día seleccionado.
- Día: tarjetas completas para trabajar. Las fotos abren su galería. Se puede cambiar entrega o responsable, crear y terminar tareas y editar etiquetas desde la tarjeta; tocar su encabezado abre opciones de pagos, entrega y ticket completo.
- Hoy, periodo anterior/siguiente y tocar el título para ir a una fecha permiten navegar. Pellizcar amplía o reduce entre Mes, Semana y Día; los botones ofrecen la misma navegación. Deslizar horizontalmente el minicalendario cambia periodo. Mantener pulsada una tarjeta abre reprogramación; el desplazamiento vertical cancela esa acción.
- Arrastrar una tarjeta en escritorio cambia exclusivamente su Fecha de entrega. Guardar o quitar una fecha ofrece Deshacer, que persiste el valor anterior. Un fallo mantiene la fecha y el formulario para reintentar.
- Atrasadas reúne entregas vencidas aún no entregadas. Entregados pendientes de pago permanecen en su día, pero no cuentan como entregas atrasadas. Sin fecha y los filtros respetan responsable, Míos, búsqueda y visibilidad de tickets. Los cerrados se excluyen inicialmente; Incluir cerrados los recupera.
- Programar entrega busca tickets existentes o permite crear y programar uno nuevo, con cliente, trabajo, teléfono opcional y fecha. El trabajo reutiliza el núcleo de productos con precio pendiente. Si una operación posterior a la creación falla, el formulario conserva el identificador creado y completa los datos pendientes sin volver a crear el ticket ni repetir el producto ya confirmado.

Las fechas opcionales viven en una sección recogida del editor de fechas, accesible desde el ticket, Kanban o panel de opciones. Se pueden agregar varias entregas parciales y deadlines, con descripción y fecha. No se obliga a tener fecha del evento para completar la fecha principal.

## Persistencia

Migración aplicada: 20261001175121_delivery_calendar_optional_dates. Añade tickets.fechas_auxiliares como array JSONB, máximo 50 entradas. set_ticket_delivery_dates guarda entrega y, cuando se solicita explícitamente, evento y fechas auxiliares, con bitácora en la misma transacción. Las operaciones de calendario actualizan solamente la fecha principal, preservando las fechas opcionales del servidor.

La función usa SECURITY INVOKER, búsqueda de esquema vacía y las políticas RLS existentes. Comprueba membresía activa, fechas entre 2000 y 2100 y estructura de los parciales/deadlines. Anon no tiene ejecución; authenticated sí. Esto sigue la [documentación de funciones de Supabase](https://supabase.com/docs/guides/database/functions). Se verificaron columna, restricciones y permisos tras aplicar la migración. Los avisos de seguridad del proyecto se revisaron; no señalan esta función nueva.

## Validación

DELIVERY-CALENDAR-QA.cjs ejecuta Chromium con respuestas de persistencia simuladas. Verifica fecha única con eventos/atención/parciales presentes, cuatro vistas, búsqueda, responsable, tareas, fotos, programación, arrastre, deshacer, fallo y reintento, creación con fallo parcial sin duplicados, navegación, atrasadas/sin fecha, pulsación larga y cancelación, pinch y deslizamiento. Comprueba ausencia de desbordamiento y altura de controles a 320/390/768/1280 px, y formularios a 320×480. Se revisaron capturas de móvil y escritorio.

MOBILE-APP-QA.cjs, KANBAN-WORKSPACE-QA.cjs, TOUCH-TICKETS-QA.cjs y DEVICE-ACCOUNTS-QA.cjs cubren regresiones de las otras vistas, gestos, teléfonos, Kanban y aislamiento de cuentas. Las pruebas de cuentas utilizan el SDK real de Supabase con red simulada. No se hicieron escrituras de prueba sobre tickets reales. Queda validar la sensación del gesto y los calendarios nativos en hardware iOS/Android; el zoom implementado cambia niveles de información.
