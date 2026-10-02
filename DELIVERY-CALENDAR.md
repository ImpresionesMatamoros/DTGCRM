# Calendario de entregas

Fecha de entrega es la fecha principal del ticket y la única que produce una entrada de calendario. Se mantiene la columna histórica fecha_compromiso para conservar las entregas ya programadas. Fecha del evento, entregas parciales y deadlines se guardan como información opcional del ticket; no crean entradas, no se consideran fechas de entrega y no se desplazan automáticamente al reprogramar la entrega. La fecha de atención anterior se conserva como dato histórico. Tener solamente fechas auxiliares equivale a estar Sin fecha de entrega.

## Uso

- Agenda: periodos consecutivos de 28 días, ampliables con el botón al final o al acercarse al final mediante scroll. Anterior/siguiente avanza exactamente 28 días y nunca omite los días 29–31. La cabecera muestra el rango real. En móvil es la primera vista cuando no hay una preferencia guardada; se respeta la vista elegida en visitas posteriores.
- Mes: escritorio mantiene visibles las seis filas de semanas, con dos nombres breves por celda y +N para las demás entregas. Seleccionar un día actualiza el panel lateral sin abandonar el mes. Los nombres se pueden arrastrar a otro día. Móvil muestra el mes completo de 42 días y la lista del día seleccionado.
- Semana: muestra el trabajo de los siete días, en dos columnas en escritorio y una lista continua en móvil. Deslizar la tira semanal avanza siete días; deslizar el mes avanza un mes.
- Día y agenda: filas compactas con cliente, trabajo, foto, responsable y etiquetas de estado. No repiten la fecha ni muestran botones vacíos para agregar etiquetas. Tocar una fila abre acciones de fecha, responsable, etiquetas, pagos, entrega y tareas pendientes; tocar la foto abre la galería.
- Hoy, periodo anterior/siguiente y tocar el título para ir a una fecha permiten navegar. Pellizcar amplía o reduce entre Mes, Semana y Día; los botones ofrecen la misma navegación. Cambiar de vista toma como ancla el día visible. Mantener pulsada una fila abre reprogramación; el desplazamiento vertical cancela esa acción. La cabecera móvil se recoge al desplazarse y reaparece al volver arriba.
- Arrastrar una tarjeta en escritorio cambia exclusivamente su Fecha de entrega. Guardar o quitar una fecha ofrece Deshacer, que persiste el valor anterior. Un fallo mantiene la fecha y el formulario para reintentar.
- Atrasadas reúne entregas vencidas aún no entregadas. Entregados pendientes de pago permanecen en su día, pero no cuentan como entregas atrasadas. Sin fecha y los filtros respetan responsable, Míos, búsqueda y visibilidad de tickets. Los cerrados se excluyen inicialmente; Incluir cerrados los recupera.
- La búsqueda reúne coincidencias de todas las fechas, incluso fuera del periodo visible, e identifica las búsquedas simultáneas del lateral y calendario. Limpiar búsqueda elimina ambas. Los demás filtros de responsable, Míos y cerrados continúan aplicándose.
- Programar entrega propone inmediatamente tickets sin fecha, muestra el día de destino y permite buscar tickets existentes o crear y programar uno nuevo, con cliente, trabajo, teléfono opcional y fecha. El trabajo reutiliza el núcleo de productos con precio pendiente. Si una operación posterior a la creación falla, el formulario conserva el identificador creado y completa los datos pendientes sin volver a crear el ticket ni repetir el producto ya confirmado.

Las fechas opcionales viven en una sección recogida del editor de fechas, accesible desde el ticket, Kanban o panel de opciones. Se pueden agregar varias entregas parciales y deadlines, con descripción y fecha. No se obliga a tener fecha del evento para completar la fecha principal.

## Persistencia

Migración aplicada: 20261001175121_delivery_calendar_optional_dates. Añade tickets.fechas_auxiliares como array JSONB, máximo 50 entradas. set_ticket_delivery_dates guarda entrega y, cuando se solicita explícitamente, evento y fechas auxiliares, con bitácora en la misma transacción. Las operaciones de calendario actualizan solamente la fecha principal, preservando las fechas opcionales del servidor.

La función usa SECURITY INVOKER, búsqueda de esquema vacía y las políticas RLS existentes. Comprueba membresía activa, fechas entre 2000 y 2100 y estructura de los parciales/deadlines. Anon no tiene ejecución; authenticated sí. Esto sigue la [documentación de funciones de Supabase](https://supabase.com/docs/guides/database/functions). Se verificaron columna, restricciones y permisos tras aplicar la migración. Los avisos de seguridad del proyecto se revisaron; no señalan esta función nueva.

## Validación

DELIVERY-CALENDAR-QA.cjs ejecuta Chromium con respuestas de persistencia simuladas. Verifica fecha única con eventos/atención/parciales presentes, cuatro vistas, búsqueda, responsable, tareas, fotos, programación, arrastre, deshacer, fallo y reintento, creación con fallo parcial sin duplicados, navegación, atrasadas/sin fecha, pulsación larga y cancelación, pinch y deslizamiento. Comprueba ausencia de desbordamiento y altura de controles a 320/390/768/1280 px, y formularios a 320×480. Se revisaron capturas de móvil y escritorio.

DELIVERY-CALENDAR-RESPONSIVE-QA.cjs verifica cinco filas simples completas inicialmente en 390×844, carga continua y navegación de meses de 31 días, febrero bisiesto y cambio de año; mes completo en móvil, semana con siete días de trabajo, búsqueda fuera del periodo, propuestas sin búsqueda, preferencia de vista, ancla del día visible al cambiar de vista, seis filas del mes y selección lateral en PC, y ausencia de desbordamiento entre 320 y 1440 px. Las acciones táctiles conservan 44 px; las celdas de escritorio usan filas breves para mantener visible el mes.

MOBILE-APP-QA.cjs, KANBAN-WORKSPACE-QA.cjs, TOUCH-TICKETS-QA.cjs y DEVICE-ACCOUNTS-QA.cjs cubren regresiones de las otras vistas, gestos, teléfonos, Kanban y aislamiento de cuentas. Las pruebas de cuentas utilizan el SDK real de Supabase con red simulada. No se hicieron escrituras de prueba sobre tickets reales. Queda validar la sensación del gesto y los calendarios nativos en hardware iOS/Android; el zoom implementado cambia niveles de información.
