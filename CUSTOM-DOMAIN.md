# CRM en crm.956print.com

Destino elegido: https://crm.956print.com. Hosting actual verificado: https://impresionesmatamoros.github.io/DTGCRM/ (HTTP 200).

Estado 2026-10-05: subdominio sin respuesta DNS; no hay sesión de Namecheap ni credenciales DNS disponibles en este entorno. No se ha cambiado el dominio de Pages todavía.

Orden de activación:
1. En DNS autoritativo de 956print.com crear CNAME: host crm, destino impresionesmatamoros.github.io, TTL automático. No modificar MX, SPF, DKIM ni registros del dominio raíz.
2. En GitHub → ImpresionesMatamoros/DTGCRM → Settings → Pages → Custom domain establecer crm.956print.com. GitHub creará CNAME en la fuente publicada. Esperar comprobación DNS y certificado; activar Enforce HTTPS.
3. Verificar inicio de sesión, abrir ticket, crear formulario, responder externamente y revisar respuesta. Las rutas actuales relativas sirven desde la raíz del nuevo dominio.
4. Añadir https://crm.956print.com a las URLs permitidas del proyecto Supabase Auth si usa redirecciones. Configurar CRM_ORIGIN con ese origen exacto en las integraciones y conservar GOOGLE_REDIRECT_URI del callback desplegado de Supabase.
5. No eliminar el alojamiento anterior ni revocar enlaces existentes. Comprobar redirecciones de enlaces /DTGCRM/client-form.html existentes, incluido su fragmento. Si la redirección conserva /DTGCRM/, preparar página de compatibilidad antes de anunciar el cambio.

Rollback: quitar dominio personalizado de Pages y CNAME crm; conservar configuración Auth anterior. No afecta datos ni correo Workspace.
