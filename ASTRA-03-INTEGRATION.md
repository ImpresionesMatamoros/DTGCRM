# DTG CRM — Captura operativa progresiva (0.25.3)

BASELINE:
commit: `67ae47cd10d113beda89c6ae86115a48c21ab4be`
archivos inspeccionados: `index.html`, `sw.js`, `ASTRA-02-work-orders.sql`, `ASTRA-02-INTEGRATION.md`, `ASTRA-02-QA.cjs`, `ASTRA-QA.cjs`.
Referencia visual inspeccionada: captura de Producción `upload/01-image.png`. No se recibió un nuevo HTML del CRM entre los archivos de esta ronda; se descargó el HEAD real de main. El HTML del commit 0c88fdad enlazado en el navegador coincide con el baseline; 67ae47cd añadió notas de activación.

## Diagnóstico confirmado

- `submitOpsEditor()` en este baseline **ya enviaba area** (ASTRA-02). El diagnóstico de ausencia de área corresponde a una versión anterior. Lo que existía era un catálogo de 13 acciones y selects nativos: no había hover, proveedores ni recorridos jerárquicos.
- `isOpsTask()` usa `tipo === "produccion"` para identificar operaciones. `taskArea()` usa `area` para decidir el KDS. Son conceptos distintos y se mantienen.
- `areaPuente()` inspecciona **tipoOperacion**, no descripción. La consulta read-only encontró `Cotizarle en China tapetes`: tipo produccion, tipo_operacion Otro, area NULL. El puente devuelve Producción. Cambiar una palabra en la descripción no resolvería esa fila.
- La otra cotización actual encontrada, `COTIZAR CON LOS CHINOS Y EN CENTRO DEL PAIS LAS CHAMARRAS`, tiene Compra/material y area NULL; el puente actual devuelve Planeación. La captura muestra “Cotizar camisetas con proveedores”, pero no se encontró una fila actual con ese texto exacto. No se presume que ambas sean la misma tarea ni que la captura corresponda al código actual.
- `submitForm(tarea_produccion)` y el comando `/produccion` aún podían llamar `addTareaCore()` sin extra.area. El editor, el comando, el formulario heredado y las acciones desde chat convergen en ese núcleo. No existe un campo que registre qué interfaz creó una tarea histórica: no se atribuye una ruta particular sin evidencia.
- El comentario de la migración 0022 describe un backfill previsto, no prueba que se haya ejecutado. No se ejecuta ni se reclasifica historial en esta entrega.
- `kdsAccion()` prefería el tipo plano, por ejemplo “Comprar”, sobre el título. Para nuevas selecciones estructuradas ahora muestra el título completo.

## Estructura compartida

`ops-menu.js` contiene acciones (ID, verbo, área), categorías operativas, recetas, proveedores y plantillas de título. `tree(mode)` proyecta las mismas recetas por acción o categoría. No hay dos árboles mantenidos manualmente.

Una receta relaciona `category + action`, define un título natural, grupos pertinentes de proveedores y variantes opcionales. Ejemplo: buy.garments → Comprar prendas; Yazbek añade “en Yazbek”. send_print.vinyl → Enviar vinil a imprimir; Alan añade “con Alan”. La clasificación comercial del catálogo no se modifica.

Para extender: añadir una receta o variante declarativa y un ID estable en `ops-menu.js`. Ambos índices la incorporan. Cambiar textos visibles no cambia IDs. No reutilizar un ID para otro significado. No se incluye un editor administrativo de acciones/áreas en esta ronda.

Las tareas siguen en `tareas`, con `tipo=produccion`, `area` explícita, título en `descripcion`, código estable en `action_code`. `action_path` (text existente) guarda JSON versionado:

```json
{"v":1,"selection":{"action":"buy","category":"garments","provider":{"id":"yazbek","name":"Yazbek","group":"garments"}},"path":["Comprar","Prendas","Yazbek"],"productId":null,"details":"","dependsOn":null}
```

El título y nombre de proveedor son snapshots. Cambiar el catálogo no renombra tareas históricas. El lector tolera action_path antiguo que no sea JSON. Editar detalles de una tarea mantiene su contexto y dependencia. La edición libre permite excepciones sin imponer responsable, progreso, producto o fecha.

Los proveedores nuevos se guardan en `app_settings`, una fila por grupo y nombre normalizado: `ops_provider_v1:<grupo>:<nombre codificado>`, values=[nombre]. Se aprovecha la PK de key para evitar sobrescribir altas concurrentes. Normalización: mayúsculas, espacios y acentos; la colisión recupera el nombre ya guardado. Los IDs compartidos de nombre no confunden Noreste (Jesús Romero) con Impresos del Noreste. No hay auto-fusión semántica. Los grupos DTF, lona y tarjetas empiezan vacíos, con opción para que DTG añada nombres confirmados.

## Interacción y guardado

- Hover con demora breve abre panel contiguo; no confirma ni reemplaza el título. Los paneles no cierran por mouseleave.
- Clic fija una selección y actualiza ruta, título y KDS. Una categoría sola deshabilita crear; Cotizar, Cortar o Comprar prendas ya son válidos.
- Flechas arriba/abajo, Home/End recorren; derecha abre; izquierda/Escape vuelve; Enter/espacio seleccionan. Tab utiliza botones nativos. Clic/tap abre y selecciona sin hover.
- “Crear tarea” es explícito. No se guarda al seleccionar una hoja ni al pulsar Enter sobre la vista de título del catálogo.
- `addTareaCore()` abre revisión para entradas operativas sin área. No inventa el área ni descarta silenciosamente la columna si falla el esquema.
- El formulario conserva borrador al fallar. Se evitan tarjetas fantasma: se añade la tarea al estado local tras confirmar inserción. Un fallo de bitácora tras insertar no provoca que el formulario solicite duplicar la tarea.
- Producto opcional del mismo ticket; no se escoge el primero. Una asociación contradictoria con la orden de trabajo requiere corrección. Los KDS leen el producto elegido, detalles y título natural.

## USPS, secuencia específica

Entregar → Paquetería → USPS permite marcar “Crear también Empaquetar primero”. Desmarcado crea solo la entrega. Marcado envía dos filas a tareas en **una inserción multirow**, con UUIDs y dependsOn en la entrega. Empaquetar va a Producción; la entrega a Planeación. No añade estados al ticket.

`kdsTasks()` excluye la entrega mientras su requisito no esté terminado. Ticket/Operaciones muestran “Espera empaquetado”. `updateTareaCore()` impide iniciar/terminar la entrega antes de tiempo; borrar el empaquetado exige eliminar primero su entrega dependiente. Completar el empaquetado habilita la misma entrega existente, sin crear una copia.

Límite: esta dependencia es una regla del cliente actual, no un constraint o trigger SQL. Un cliente antiguo o una escritura directa a la API puede ignorarla. No es una frontera de autorización. No se generaliza a otras ramas.

## Esquema, backend y seguridad

No requiere migración ni Edge Function. Se verificaron read-only `tareas.area`, `action_code`, `action_path`, `work_order_id` y la configuración actual. ASTRA-02 ya está aplicada. La UI bloquea el guardado estructurado si no puede verificar ese esquema.

Se mantienen RLS y permisos existentes. Los proveedores son configuración compartida, no datos privados. Se detectó una política amplia preexistente en app_settings junto a is_active_member(); no se modifica en esta corrección. Queda como deuda de seguridad para revisión separada.

No se escribieron tareas, proveedores o reclasificaciones de prueba en Supabase real. El service worker no se modifica: no intercepta fetch. index y los dos assets nuevos deben publicarse juntos.

## QA ejecutado y límites

- `ASTRA-03-DOM-QA.cjs`: **PASS**, ejecución real de funciones del editor/core/KDS en JSDOM 26.1.0 con Supabase simulado y sin red a producción. 16 creaciones (8 casos por ambos recorridos), títulos, áreas, ticket, selección de producto, detalles, altas de proveedor y deduplicación.
- Eventos pointer sintéticos verifican apertura sin selección; eventos de teclado verifican avance, selección y Escape. No equivalen a inspección visual o tacto físico.
- USPS con y sin empaquetado; payload atómico, bloqueo/desbloqueo KDS y guardas de actualización/borrado.
- Falla de guardado conserva título libre, área, detalles y producto; botón delegado real crea; entrada heredada sin área abre revisión; editar historial no rellena area; tareas normales conservan tipo; completar operación no cambia estado del ticket.
- `ASTRA-02-QA.cjs`: PASS para regresiones de abrir ticket, órdenes y cantidad KDS sin primer producto arbitrario. Se quitaron asserts del catálogo reemplazado; ahora los cubre ASTRA-03.
- `ASTRA-QA.cjs`: PASS, menciones/referencias/feed/hilos. Compilación de scripts inline y `node --check ops-menu.js`: PASS. `git diff --check`: PASS.
- Se intentó Chromium con Playwright; el entorno rechazó socket() al iniciar Chromium. **No pasó QA de navegador**, no hay screenshots generados ni prueba física de mouse, iPhone/PWA, Android o táctil.
- `ASTRA-03-QA.cjs` deja preparado el ensayo de navegador con viewport móvil y tap. Ejecutarlo en un equipo con Chromium habilitado. No se presenta como aprobado.
- Persistencia probada con doble de DB; no se afirma prueba end-to-end real ni Realtime de una secuencia entre dos sesiones.

Para repetir DOM: instalar jsdom@26.1.0 en entorno de QA y ejecutar `JSDOM_MODULE=/ruta/node_modules/jsdom node ASTRA-03-DOM-QA.cjs`. Browser: instalar playwright@1.62.1 (o la versión fijada por tu entorno de QA) y su Chromium compatible, luego `PLAYWRIGHT_MODULE=/ruta/node_modules/playwright CHROME_BIN=/ruta/chrome node ASTRA-03-QA.cjs`. El servidor de QA solo sirve el repo local y bloquea peticiones externas en el browser.

## Pendiente de DTG

Confirmar proveedores de DTF/lona/tarjetas, equivalencia o separación definitiva de los dos Noreste, y si preparar gang sheet/impresión interna se reparten distinto entre áreas. El mapeo inicial trata preparación digital como Planeación e impresión/acabados físicos como Producción. Responsable no se asigna automáticamente por nombre de empleado.

Validación presencial recomendada antes del turno: una tarea por cada ruta, pasar diagonalmente al submenú, scroll y tap en teléfono, y empaquetar/entregar con dos sesiones. No se añadieron bots, tareas automáticas para enviar cotizaciones, backfill, cambios de cobro/entrega, ni un segundo almacén de tareas.

## Archivos

Modificados: index.html, ASTRA-02-QA.cjs. Los changelog/notas históricos permanecen intactos; este documento audita únicamente esta corrección.
Nuevos: ops-menu.js, ops-menu.css, ASTRA-03-DOM-QA.cjs, ASTRA-03-QA.cjs, ASTRA-03-INTEGRATION.md.

## Publicación sobre main actualizado

La corrección se integró sobre `4184ccaa950453d776edda4b1397f7f1c30dab12`, conservando íntegra la corrección de Realtime añadida después del baseline original. Aplicación de tres vías sin conflictos. No se modificaron los changelogs históricos ni se ejecutaron migraciones para esta publicación.
