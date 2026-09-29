# QA — Ticket UX, 2026-09-29

Baseline f23799564b95f4f4c324cc9fce6cfb8a769b72ae.

Ejecutado satisfactoriamente:
- JSDOM_MODULE=/tmp/dtg-qa/node_modules/jsdom node TICKET-UX-QA.cjs: foco/Enter de producto, precio opcional, error conservando campos, guardado único, ID servidor, tareas heredando producto, fallback de esquema anterior, mensajes de ticket, IME/Shift+Enter, referencias, hilos y navegación contextual de notificación.
- JSDOM_MODULE=/tmp/dtg-qa/node_modules/jsdom node ASTRA-03-DOM-QA.cjs: 16 creaciones, ambos recorridos, handlers pointer/teclado, áreas explícitas, USPS, producto, detalles y proveedores.
- node ASTRA-02-QA.cjs; node ASTRA-QA.cjs: regresiones de título/KDS/referencias/hilos.
- git diff --check.

Son pruebas DOM y base de datos simulada, no pruebas de escritura en producción. Un primer comando sin JSDOM_MODULE falló por dependencia no encontrada; repetido con la ruta instalada pasó.

No probado: RLS de nueva migración (no ejecutada), realtime autenticado en dos equipos, push/transcripción reales, audio físico iPhone/Android, teclado virtual, layout/tacto en navegador. No se presentan estos casos como verificados. La conversación nueva requiere backend y permanece desactivada.
