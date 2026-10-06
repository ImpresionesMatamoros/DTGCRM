# Tareas v2, Pagos, Cobranza y KDS

## Tareas
- **Pasos en cadena o en paralelo:** `tareas.depends_on` (migración `20261006000001_tareas_depends_on.sql`). NULL = paralela (punto); con valor = va después (número 1·2·3). Sin ciclos. Botones ↳ (agregar siguiente), ⇅ (hacer paralela), arrastrar sobre otra (= después) o a "Soltar aquí = en paralelo", y la palomita "Va después de la anterior" dentro del editor.
- **Kanban:** bloque TAREAS en cada tarjeta, `SIN TAREA` en rojo si no hay ninguna. Los entregados con saldo ya no salen en el Kanban (viven en Cobranza).
- **Catálogo único** agrupado (Cliente, Diseño, Compras y proveedores, Taller, Entrega). Se quitaron COBRAR (de tickets), IMPRIMIR LONA, ENVIAR DTF/DTF UV/TABLOIDES, ORDENAR EN LINEA/A MONTERREY, COMPRAR MATERIAL. Las tareas ya creadas conservan su nombre. `/tarea` y `/produccion` abren el editor con la tarea del catálogo.
- **Automáticas:** CONSEGUIR ARCHIVOS → CONFIRMAR LA CALIDAD (LETS ENHANCE); ENVIAR DISENO → CONSEGUIR APROBACION; ORDENAR MATERIAL (vendedor) → PAGAR Y ENVIAR COMPROBANTE en paralelo; ENVIAR TRABAJO CON PROVEEDOR → RECOGER → PAGAR Y ENVIAR COMPROBANTE.
- Sin estados ni porcentajes en la TV (se quitó la tecla ESPERAR).

## Pagos por realizar (sin tablas nuevas)
- La tarea `PAGAR Y ENVIAR COMPROBANTE` guarda empresa, total (`amount`) y `urgent` en `action_path`.
- Fichas de vendedores/proveedores (banco, titular, cuenta, CLABE, curfew, notas): `app_settings`, clave `ops_payee_v1:<grupo>:<id>`, `values[0]` = JSON. Altas nuevas: `ops_provider_v1:<grupo>:<id>`.
- Vendedor = se paga antes (aparece al crear ORDENAR MATERIAL). Proveedor = se paga después (aparece al terminar RECOGER).
- "TOTAL AÚN NO DISPONIBLE" hasta capturar el total; countdown al curfew; URGENTE pone una barra roja arriba del CRM en cualquier pantalla. Todos pueden marcar YA PAGUÉ.
- Los números de cuenta solo se ven dentro de Pagos por realizar (nunca en el Kanban ni en la TV).

## Cobranza
- Pestañas **Cobrar hoy / Por cliente / Todos los tickets**. Totales: por cobrar, cobrar hoy, promesas vencidas, cobrado en 7 días.
- Seguimiento y promesa de pago se guardan en la bitácora del ticket (`tipo sistema`, `kind cobranza`). "Cobrar hoy" = promesa vencida o sin contacto en 3 días (y sin promesa vigente).
- Por cliente: llamar, WhatsApp con mensaje listo, copiar estado de cuenta, registrar pago.

## KDS
- Menú **KDS** a la izquierda: botones Ver TV de PRODUCCIÓN / PLANEACIÓN / PAGOS / POR COBRAR, vista previa de cada TV y orden por importancia (flechas o arrastrar).
- Orden manual en `app_settings` (`kds_order_v1:<tablero>`). Lo urgente/vencido siempre queda arriba.
- `?display=pagos` abre la TV de Pagos (DONE = pagado, con confirmación).

## Pruebas
`TASKS-PLAN-QA.cjs`, `TASKS-CATALOG-QA.cjs`, `PAGOS-QA.cjs`, `COBRANZA-QA.cjs`, `KDS-MENU-QA.cjs`.
