# Kanban como espacio principal de trabajo

El inicio abre Tickets en Kanban. El buscador lateral y el del espacio de trabajo comparten consulta; todas las vistas de tickets se filtran y las columnas vacías se ocultan durante la búsqueda. Las vistas alternativas y los filtros permanecen recogidos: se muestran con Opciones, desplazando hacia arriba al inicio o tirando hacia abajo en móvil.

Las tarjetas permiten agregar fotos, ajustar ubicación y fechas, cobrar, marcar entrega y crear, editar o terminar tareas sin entrar al ticket. Entregado pendiente por pagar permanece en el Kanban. Las ocho etiquetas solicitadas sustituyen los antiguos marcadores y Qué sigue. Las dos etiquetas de entrega/pago se calculan con la entrega y el saldo real: elegirlas abre la acción correspondiente, sin inventar pagos. Los valores históricos se conservan, pero sus controles desaparecen.

Ubicación presenta un mapa esquemático seleccionable con 26 ciudades y búsqueda. Es una orientación visual, no navegación GPS. La distribución regional se contrastó con el [mapa oficial del RGV MPO](https://www.rgvmpo.org/home/showpublisheddocument/1676/638555096878700000). Fechas guarda por separado Entrega prometida y Evento o uso del cliente, en una sola operación autorizada y con registro en bitácora.

Tareas sustituye Operaciones y ofrece listas Activas, Planeación, Producción, Mis tareas y Terminadas. Las tareas cerradas desaparecen de las vistas habituales. Cada fila y las tareas de las tarjetas tienen un botón para terminarlas; un error de persistencia restaura la tarea.

El formulario contiene exclusivamente nombre del catálogo de 13 tareas, responsable y destino. Quien crea es el responsable inicial. Al cambiar responsable durante la creación se propone su destino configurado: Planeación por defecto, Producción para Israel y Alex. Alexia conserva Planeación. El destino elegido manualmente se respeta; editar una tarea existente nunca lo cambia automáticamente por cambiar responsable. El menú de cuenta permite guardar el destino propio para futuras tareas. Los detalles antiguos de tareas existentes se preservan al editar sus tres campos.

## Base de datos

Migración aplicada: 20261001171135_kanban_workspace_dates_task_defaults_and_cities. Añade fecha_evento y default_task_area, amplía ciudades y permite esperando_demo. La función set_ticket_work_dates usa SECURITY INVOKER y RLS existente, valida ambas fechas y registra la actualización atómicamente. No concede ejecución a usuarios anónimos. No borra registros históricos.

## Validación

KANBAN-WORKSPACE-QA.cjs prueba búsqueda compartida, herramientas ocultas, etiquetas, estados financieros, carga de fotos, fechas atómicas, 26 ciudades, catálogo, asignación inicial, destino manual, edición, finalización con rollback y preferencias a 320/390/768 px. MOBILE-APP-QA.cjs verifica siete vistas y formularios; TASKS-SIMPLE-QA.cjs verifica creación desde Kanban/chat, persistencia y recuperación de errores. TOUCH-TICKETS-QA.cjs, CHAT-INBOX-QA.cjs, CHAT-WHATSAPP-QA.cjs, WA-AUDIO-QA.cjs y DEVICE-ACCOUNTS-QA.cjs cubren gestos, imágenes, teléfonos, chat, audio y aislamiento de cuentas.

Pruebas ejecutadas en Chromium con respuestas y datos simulados; cambio de cuentas también con el SDK real de Supabase y red simulada. No se modificaron tickets reales para probar. La sensación táctil y los calendarios nativos requieren comprobación en teléfono físico.