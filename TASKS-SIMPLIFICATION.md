# Simplificación de tareas y menú de cuenta

## Plan implementado

- Abrir/cerrar el menú de cuenta modifica únicamente su contenedor; conserva el DOM, el scroll y el borrador de la pantalla.
- Crear desde un mensaje: botón directo, texto precargado, ticket sugerido solo por una relación existente y confirmación. Al guardar permanece en el chat.
- Crear desde Kanban: + Tarea en cada tarjeta, descripción libre y Crear tarea. Se elimina la opción duplicada del menú de tarjeta.
- Formulario inicial: descripción, responsable y destino. Las tareas nuevas van a Planeación por defecto, visible y modificable.
- Fecha, relación con producto, catálogo guiado, tipo, estado, progreso y eliminación quedan en Más opciones.
- Se reutilizan addTareaCore/updateTareaCore y el registro de contexto del mensaje. Sin migraciones ni cambios en permisos.

## Validación

TASKS-SIMPLE-QA.cjs usa Chromium/Playwright y dobles de persistencia con los handlers y funciones reales del CRM. Ejecutar con node TASKS-SIMPLE-QA.cjs; CHROME_BIN permite indicar un navegador instalado y QA_SCREENSHOT una ruta opcional de captura.

Probado: creación desde Kanban y mensaje vinculado en dos clics; texto y destino guardados; contexto de origen; permanencia en chat; edición conserva fecha/estado/progreso; fallo conserva borrador y permite reintentar; catálogo avanzado; mensaje sin vínculo exige elegir ticket; menú móvil conserva scroll y nodo DOM; cierre por clic fuera; formulario móvil sin desbordamiento.

También pasó ASTRA-QA.cjs (menciones, referencias, hilos y aislamiento del feed) y el QA de chat de la vuelta anterior.

## Límites

Una tarea sigue perteneciendo a un ticket. Un mensaje sin ticket requiere seleccionarlo, además de los dos clics de crear y confirmar. No se adivina ni crea un ticket de inventario automáticamente.

Validación con datos simulados en navegador; no se usaron cuentas reales ni se escribieron tareas en Supabase.
