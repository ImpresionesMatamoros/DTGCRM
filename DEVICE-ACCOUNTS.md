# Cambio rápido de usuario — dispositivos compartidos

## Uso

1. Toca el botón de usuarios en Chats o en la barra móvil. En escritorio también está junto a la cuenta en la barra lateral.
2. Toca la persona que va a trabajar. Si su sesión sigue vigente, entra sin escribir contraseña.
3. Para registrar otra persona, toca **Agregar cuenta** e inicia sesión con su correo y contraseña. Las cuentas ya registradas siguen disponibles en **Elegir cuenta guardada**, también desde la pantalla de acceso.

El selector recuerda cuentas y la última selección en ese navegador o PWA del dispositivo. El servidor puede dar por terminada una sesión; en ese caso se vuelve a pedir contraseña y el correo aparece preparado. Una cuenta desactivada en `profiles` no puede entrar al CRM.

**Quitar** elimina el acceso recordado de esa cuenta en el dispositivo. Quitar la cuenta actual o **Cerrar sesión** sale de ella; las otras personas guardadas siguen disponibles. Se usa cierre de sesión local, sin cerrar la cuenta en sus otros dispositivos.

La interfaz indica expresamente que cualquier persona que use ese dispositivo puede abrir las cuentas guardadas sin contraseña. Esta es la función solicitada para la tablet compartida.

## Implementación

- Se conserva Supabase JS **2.45.4**, ya fijado por la aplicación.
- Cada cuenta usa un cliente Supabase y una `storageKey` distinta, con sesiones auténticas y refresco gestionado por el SDK. La sesión previa de la aplicación se conserva usando su clave existente.
- El índice de cuentas guarda únicamente ID, clave de almacenamiento, nombre, correo, color y última selección. No guarda contraseñas ni copias de tokens; los tokens de sesión permanecen en el almacenamiento habitual del SDK, separados por cuenta.
- Al cambiar, se detienen las suscripciones y el refresco automático de la cuenta anterior. Se retiran datos, archivos, URLs firmadas, audio, avisos y acciones de reintento antes de cargar la identidad nueva. Las respuestas tardías de lecturas anteriores no pueden reemplazar su estado ni su caché de medios.
- El SDK recupera o renueva la sesión guardada; `getUser()` verifica al usuario de destino. El perfil activo y los datos se consultan con esa sesión. No hay suplantación por nombre, contraseñas maestras, claves de servidor ni cambios a RLS.
- Cambiar mientras una escritura optimista, guardado de tarea/documento o envío de archivo/audio sigue pendiente muestra «Espera a que termine de guardar o enviar».
- Se libera la suscripción push anterior. Si la cuenta nueva tenía push habilitado y permiso concedido, se vuelve a asociar al usuario actual; la operación valida identidad después de cada espera.
- Avisos del navegador se cierran al dejar la cuenta. La coordinación entre pestañas se separa por usuario, para no compartir marcas de lectura entre personas diferentes.
- El selector abre sin reconstruir toda la pantalla, tiene botones grandes, navegación de teclado, cierre con Escape y foco contenido dentro del diálogo.

Documentación contrastada: [configuración del cliente y persistencia](https://supabase.com/docs/reference/javascript/initializing), [storageKey en la versión utilizada](https://github.com/supabase/supabase-js/blob/v2.45.4/src/lib/types.ts), [cierre local de sesión](https://supabase.com/docs/reference/javascript/auth-signout). Se revisó el changelog vigente; las notas consultadas no requieren cambios en estos flujos de autenticación.

## Validación

`DEVICE-ACCOUNTS-QA.cjs` ejecuta el render y el SDK real **2.45.4**, con endpoints de prueba aislados. Comprueba:

- Migración de la sesión existente, agregar una segunda cuenta, entrar sin revocar la primera y cambiar mediante botón + persona.
- Persistencia de cuentas y selección después de recargar.
- Renovación de access token vencido sin volver a mandar contraseña.
- Sesión revocada: acceso solicitado de nuevo y ausencia del contenido del usuario anterior.
- Perfil inactivo bloqueado y no añadido al selector.
- Escritura pendiente: cambio bloqueado con aviso.
- Asociación push de prueba: identidad del registro coincide con el token del SDK de la cuenta seleccionada.
- Respuesta vieja demorada: no pisa los datos de la cuenta nueva.
- Quitar otra cuenta no cierra la actual. Logout es local, borra su credencial y no elimina las demás.
- Selector a 768 × 1024 y 390 × 844, sin desbordamiento, Escape y ausencia de contraseñas persistidas.

Los casos usan usuarios y tokens ficticios; no inician ni cierran sesiones reales de empleados. Consulta de solo lectura en producción confirmó RLS y políticas existentes para `profiles`, `tickets`, `team_posts` y `ticket_access`. No hubo migración ni cambios de permisos.

Para ejecutar el test, instala o utiliza Node/Playwright/Chrome disponibles. Descarga la misma librería fijada por la app junto al test:

```powershell
Invoke-WebRequest 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/dist/umd/supabase.js' -OutFile supabase-sdk.js
node DEVICE-ACCOUNTS-QA.cjs
```

`CHROME_BIN` permite indicar la ruta de Chrome. El archivo descargado es una dependencia temporal de la prueba y no necesita incorporarse al repositorio.

También se ejecutan las regresiones de interfaz móvil, Chats y tareas. Queda como comprobación manual usar cuentas reales en la tablet física, con su configuración de expiración y notificaciones del navegador. No se promete acceso perpetuo a sesiones revocadas por el servidor.
