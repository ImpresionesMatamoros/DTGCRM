# Tareas v2

- **Pasos en cadena o en paralelo:** `tareas.depends_on` (migración `20261006000001_tareas_depends_on.sql`). NULL = paralela (punto); con valor = va después (número 1·2·3). Sin ciclos.
- **Kanban:** bloque TAREAS en cada tarjeta, `SIN TAREA` en rojo si no hay ninguna, botón ↳ (agregar siguiente), ⇅ (hacer paralela), arrastrar sobre otra (= después) o a "Soltar aquí = en paralelo".
- **Catálogo único** (un solo selector agrupado): Cliente, Diseño, Compras y proveedores, Taller, Entrega. Se quitaron COBRAR, IMPRIMIR LONA, ENVIAR DTF/DTF UV/TABLOIDES, ORDENAR EN LINEA/A MONTERREY, COMPRAR MATERIAL. Las tareas ya creadas conservan su nombre.
- **ORDENAR MATERIAL** pide vendedor (se paga antes) y crea `PAGAR Y ENVIAR COMPROBANTE` encadenada: "TOTAL AÚN NO DISPONIBLE" hasta capturar el total; luego total grande y empresa.
- **ENVIAR TRABAJO CON PROVEEDOR** pide proveedor (se paga después) y crea `RECOGER` encadenada.
- `CONSEGUIR ARCHIVOS DEL CLIENTE` → `CONFIRMAR LA CALIDAD (LETS ENHANCE)`; `ENVIAR DISENO` → `CONSEGUIR APROBACION`.
- Vendedores y proveedores: listas en `ops-menu.js` (`vendor`, `provider`); OTRO (solo esa tarea) y AGREGAR NUEVO (se guarda en `app_settings`, `ops_provider_v1:<grupo>:<id>`).
- Las tareas de pago no salen en las TV de Producción/Planeación; las bloqueadas tampoco.
- Pendiente (fases del plan): Cobranza, menú/tabla Pagos por realizar (`payees`, `task_payments`, URGENTE), menú KDS.
- Pruebas: `TASKS-PLAN-QA.cjs`, `TASKS-CATALOG-QA.cjs`.
