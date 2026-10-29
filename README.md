# DTGCRM

CRM de **Design To Go**. Proyecto: https://github.com/ImpresionesMatamoros/DTGCRM

- Aplicación publicada: https://crm.956print.com/
- GitHub Pages publica la raíz de `main` automáticamente.
- La interfaz y la lógica principal están en `index.html` (sin proceso de compilación).
- Entrada de Tickets: `resetTicketsEntry()` aplica **Detalles + Abiertas** al iniciar, cambiar cuenta o entrar al módulo. Las otras vistas y filtros siguen disponibles durante la sesión.
- Verificación de esta política: `node TICKETS-DEFAULT-QA.cjs` (requiere Playwright y Chrome; `CHROME_BIN` permite seleccionar otro ejecutable).
- Verificación de carga de datos: `node APP-STARTUP-QA.cjs`.

No guardar tokens ni sesiones en el repositorio. Usar la conexión de GitHub o la autenticación local de GitHub CLI.
