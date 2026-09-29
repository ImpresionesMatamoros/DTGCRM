# Astra 02 · Órdenes, KDS y fricciones de uso

Baseline: `5fdad896d027c072dd1c58f1323707b571825a66` (`main`, 29 sep 2026 UTC).

## Entrega publicada sin migración

- Kanban de responsables: el tablero desplaza ambas direcciones con cabeceras pegadas; el nombre del cliente abre el ticket. La ficha de cliente (`↗`) y la edición (`✎`) conservan controles explícitos.
- Las fotos operativas del ticket, Equipo, Biblioteca y detalle KDS abren un visor grande al tocarlas. La galería del ticket usa más espacio; Escape y el botón cierran el zoom.
- El editor existente de tareas de operación tiene un catálogo corto con rutas **Por categoría** y **Por acción**. Ambas resuelven el mismo código; el área se elige por acción y las acciones libres exigen área explícita. La fecha de atención vive en la tarea.
- KDS prioriza fecha de la tarea y muestra cantidad de la orden vinculada si existe; si un ticket sin orden tiene varios productos, no inventa que el primero corresponde a la tarea. Space abre el detalle 30 segundos. Se conserva la densidad 4/6/8 y el teclado anterior.

## Pendiente de migración

`ASTRA-02-work-orders.sql` crea `work_orders`, agrega `work_order_id`, `action_code` y `action_path` a `tareas`, exige integridad de ticket/producto/orden y RLS para las órdenes. La UI de órdenes se oculta mientras la tabla no existe. El editor de tareas sigue guardando área, fecha y tipo en columnas existentes; los códigos y rutas solo se guardan después de la migración.

La migración también retira políticas antiguas `authenticated read/write ...` en seis tablas. Hoy coexisten con políticas de visibilidad y, por ser permisivas, conceden acceso a cualquier usuario autenticado. La revisión automática rechazó ejecutar esta migración en producción: cita la prohibición anterior de ejecutar migraciones y la amplitud del cambio RLS. **No se ejecutó SQL de escritura.** Necesita autorización explícita para aplicar esa migración concreta. Revisar y probar RLS con dos identidades antes de usar tickets privados.

## QA realizado

- `node ASTRA-QA.cjs`: pasa pruebas de chat previo.
- `node ASTRA-02-QA.cjs`: pasa catálogo/área, rutas equivalentes, clic en nombre, orden y cantidad KDS.
- `git diff --check` y compilación sintáctica de los scripts de `index.html`: pasan.
- Inspección read-only del esquema y las políticas Supabase: 108 tickets, 14 tareas heredadas sin `area`, 55 productos, 0 tickets privados en el momento de la consulta.

## Pruebas pendientes

No se ha probado físicamente el desplazamiento/drag del Kanban, iPhone/PWA, pantalla KDS a distancia, ni RLS con dos sesiones reales. Tampoco se han creado órdenes sobre la base real porque la migración no fue aplicada. Las 14 tareas heredadas aún dependen del puente de clasificación previo; revisarlas una por una con el equipo. La imagen mostrada en KDS es la foto más reciente del ticket, no una referencia aprobada por orden.

## Fuera de esta ronda

Catálogo exhaustivo de acciones, orden parcial de cantidades, edición/eliminación de órdenes, vínculos entre órdenes e hilos privados, selección manual de imagen principal, reclasificación automática de tareas antiguas y cambios en CxC/pagos/documentos.
