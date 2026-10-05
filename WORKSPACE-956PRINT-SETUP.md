# Workspace para 956print.com

Pendiente de contratación y conexión. Este documento no aplica cambios DNS ni contrata servicios.

Abre [Google Workspace en inglés para Estados Unidos](https://workspace.google.com/intl/en_us/). Registra el dominio 956print.com, sin www. El idioma de la página no determina el país de facturación: usa los datos reales del negocio. [País de facturación](https://knowledge.workspace.google.com/admin/support/troubleshooting/selected-wrong-billing-country).

Para el volumen de originales se propone Business Standard, una cuenta real administradora/operativa. Precio estándar publicado el 5 de octubre de 2026: US$16.80 por usuario/mes flexible, o US$14 por usuario/mes con compromiso anual; comprobar impuestos y promociones al contratar. [Tabla oficial](https://knowledge.workspace.google.com/admin/billing/compare-flexible-and-annual-fixed-term-payment-plans).

## Preparación y DNS

1. Crear la cuenta real y conservar acceso administrativo y recuperación. No compartir la contraseña en el chat. Elegir el correo principal durante el alta; los aliases se configuran después.
2. Copiar el TXT de verificación que Google genere específicamente para esta cuenta y añadirlo al dominio raíz en Namecheap. No hay un token genérico que pueda anticiparse.
3. Después de verificar, seguir el asistente de activación de Gmail. La documentación actual indica MX smtp.google.com con prioridad 1; usar exactamente lo que muestre el asistente de esta cuenta. [MX oficial](https://support.google.com/a/answer/87127?hl=en).
4. Los registros observados eran los de reenvío de Namecheap. Revisar su uso antes de sustituir los MX: cambiar MX mueve la recepción de correo. No modificar registros web de www ni nameservers para activar Gmail.
5. Mantener un solo registro SPF. Si únicamente Google envía correo, el valor documentado es `v=spf1 include:_spf.google.com ~all`. Si siguen enviando otros servicios, combinar todos los remitentes autorizados en ese único SPF y revisar sus límites; no añadir un segundo SPF. [SPF oficial](https://support.google.com/a/answer/33786?hl=en).
6. Generar DKIM en la consola de Google, publicar el TXT exacto indicado y activar la firma. Configurar DMARC con una política inicial de monitorización y un destino de reportes real; endurecerla después de comprobar alineación de todos los emisores. [Autenticación Gmail](https://support.google.com/a/answer/81126?hl=en).
7. Crear aliases info, sales, orders, billing, design y vendors bajo 956print.com para la misma cuenta. Verificar en Gmail que estén disponibles como send-as y que la API confirme su estado. Los empleados entran al CRM con sus propias cuentas y permisos; no necesitan conocer la contraseña de esa cuenta central.
8. Probar recepción desde un dominio externo y envío desde cada alias, incluyendo SPF/DKIM/DMARC. Después conectar OAuth desde el CRM en staging y verificar permisos temporales de Drive con un proveedor de prueba.

No se puede completar OAuth ni comprobar expiraciones reales antes de que exista la cuenta. El código de la rama queda preparado, desactivado, para esa conexión posterior.
