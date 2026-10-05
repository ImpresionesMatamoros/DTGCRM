# Correos y configuración de Workspace

Acceso global: menú de cuenta → Configuración de correo (solo administradores). También Correos → Conexiones y permisos. Dentro de un ticket, Archivos y correo conserva las acciones relacionadas con ese ticket.

Google OAuth de producción configurado en Vault; los valores secretos no se guardan en Git. Falta iniciar sesión del CRM y autorizar martin@956print.com en Google. Después: Actualizar, Detectar y validar aliases y activar integraciones. Los 17 aliases creados por el propietario requieren validación real de Gmail.

La sección Correos permite bandejas, hilos, remitente verificado, respuesta editable, CC/CCO, vínculo explícito a ticket, borradores cifrados por usuario y permisos internos por bandeja. Envío solo por acción explícita; resultados inciertos no se reenvían automáticamente.

Limitaciones: envío de texto; adjuntos se consultan en Gmail. Búsqueda sobre correos cargados con paginación. No se crean tickets automáticamente. No se ha enviado una prueba real: falta consentimiento OAuth.

Migraciones: workspace_mail_accounts y workspace_mail_scheduler. Backend: integration-api, google-oauth-callback e integration-worker. Scheduler con gate OFF y lectura privada de Vault.

Pruebas: MAIL-QA e integrations-ui con proveedor/sesión simulados; 28 casos de backend; PostgreSQL local con RLS y cifrado. Las suites históricas tienen fallas previas documentadas; no se afirma regresión completa.

Los timestamps remotos de migraciones pueden diferir del nombre local por despliegue MCP: reconciliar historial antes de supabase db push.
