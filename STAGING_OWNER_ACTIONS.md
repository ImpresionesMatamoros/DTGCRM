# Lo que falta para abrir STAGING

El código está preparado. Todavía no hay una URL remota de laboratorio ni base staging provisionada.

1. **Crear dos proyectos Supabase nuevos:** CRM staging y PE staging. No reutilizar los proyectos existentes inventariados ni sus claves.
2. **Resolver el esquema inicial del CRM:** proporcionar y revisar un baseline de esquema completo sin datos/secretos. Las migraciones de Git no reconstruyen solas una DB vacía.
3. **Elegir hosting separado:** CRM estático en un origen nuevo; PE como servicio HTTPS con DB PE staging. Mantener GitHub Pages productivo intacto. No se necesita dominio comprado.
4. **Configurar datos de prueba:** usuarios confirmados `example.invalid`, buckets vacíos/políticas y fixtures; catálogo/precios comerciales revisados del motor. Nada se clona del CRM real.
5. **Acceso y secretos:** configurar GitHub Environment staging y token Supabase limitado al proyecto nuevo, token PE staging, claves y conexiones privadas nuevas. Ver `STAGING_VARIABLES.md`.
6. **Activar en orden:** preflight DB → STEP 10 → PE → proxy/stubs → build → hosting → pruebas remotas → habilitar deployment staging.

El runbook contiene comandos, precondiciones y pruebas. Ningún paso requiere cambiar producción. La promoción a main se tratará después de que el laboratorio pase su aceptación real.
