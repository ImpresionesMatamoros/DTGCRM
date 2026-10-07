# Crear forma para cliente

El botón visible del ticket crea una forma del pedido y copia su enlace. Si el navegador niega el acceso al portapapeles, conserva el enlace visible y un botón Copiar enlace. No depende de Gmail ni requiere que el cliente inicie sesión.

El servidor captura un resumen de los productos guardados: descripción, cantidad, precio unitario e importe. Ejemplo verificado: dos camisetas a USD20 muestran USD40 como total de productos. No incorpora automáticamente impuestos, envío o cargos de un documento comercial; la pantalla lo aclara. La moneda inicial de este flujo es USD.

Nombre, teléfono, correo, fecha de compromiso y zona ya definidos aparecen en gris y no se solicitan de nuevo. El nombre provisional basado en teléfono se considera pendiente. Los campos bloqueados no están en la lista de respuestas permitidas; el servidor rechaza intentos de modificarlos. Cantidades y precios tampoco son editables por el cliente.

Cuando no existe fecha, el cliente puede proponer una fecha de entrega. Las respuestas se guardan vinculadas al ticket. En Formularios, el equipo usa **Aplicar datos pendientes al ticket**: confirma la propuesta de fecha y completa exclusivamente campos aún vacíos. No reemplaza valores agregados por el equipo después de crear el enlace. Guarda una bitácora y soporta reintentos sin duplicar la aplicación. Si se cambió el cliente vinculado mientras estaba abierta la forma, la aplicación se detiene para revisión.

El formulario conserva el resumen comercial del momento de creación. Si cambian productos o precios, crear una forma nueva y revocar la anterior. Vigencia inicial: siete días. Los enlaces pueden renovarse o revocarse; el token se almacena únicamente como hash. Una forma respondida no acepta otra respuesta diferente.

Archivos: client-forms.js/css, client-form.html, index.html, client-order-form-schema.sql, client-order-form-customer-guard.sql y CLIENT-ORDER-FORM-DB-QA.cjs.

Migraciones de producción: client_order_forms_snapshot_and_review y client_order_forms_customer_guard. El SQL principal ya incorpora la protección de cliente; el archivo de protección permite actualizar despliegues de la primera versión. No reejecutar el SQL principal sobre tablas ya migradas.

QA con PostgreSQL/PGlite: resumen 2 × 20 = 40, restricciones de campos, área válida, creación/envío/aplicación idempotentes, permisos anónimos, cambios posteriores del equipo y fecha bloqueada. Los formularios anteriores y las integraciones existentes mantienen sus pruebas.

Verificación en producción: ticket interno #1417, dos camisetas a USD20, enlace creado con confirmación de copia, formulario abierto, respuesta enviada, datos aplicados a cliente y zona Brownsville; teléfono y fecha 2026-10-20 permanecieron intactos. Los datos de prueba se revocan/archivan al finalizar.
