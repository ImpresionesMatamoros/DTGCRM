# Validación del laboratorio — 3 octubre 2026

## Pruebas reales aprobadas

- Auth de usuario ficticio y membresía activa/RLS.
- Engine sin autorización: 401. RPC de credenciales rechazada para usuario autenticado. Esquema PE no expuesto en Data API CRM.
- CRM → proxy autenticado → API original PE → catálogo de Postgres.
- Flyers, cantidad 250, precio autorizado USD45. Ventas guardadas a USD45, USD40 y USD50, conservando snapshot45 y precio vendido al recargar.
- Intento de sobrescribir snapshot rechazado por la base.
- QUOTE_ONLY para cantidad251: total de catálogo nulo; precio provisional manual guardable.
- Revisión autorizada de catálogo a USD46: snapshots históricos permanecen45; restauración con nueva revisión autorizada a45 comprobada.
- Engine desplegado temporalmente indisponible: proxy503; ticket y producto manualUSD25 guardados. Engine original restaurado y precio45 comprobado.
- Inicio/login real del CRM contra staging en390px y1280px: sin errores JS ni REST fallidos, banner visible. Capturas revisadas.

## Límites de la evidencia

La prueba de interfaz sirve el build local en el origen configurado y usa Auth/DB reales. La publicación privada tiene recibo de despliegue exitoso; no se afirma una sesión de navegador remoto del usuario. No se enviaron correos/push/mensajes externos ni se probaron pagos reales.

Catálogo dev-slice entregado, no importación comercial final.

## Seguridad

Search_path fijado para las funciones PE propias, sin modificar funciones de extensiones ni reglas de negocio. RLS y grants restringidos; sin acceso público al catálogo ni privilegio del runtime sobre tickets. Credenciales solo Vault/servidor.

Los avisos SECURITY DEFINER de las RPC CRM de membresía/privacidad son intencionales y conservan comprobaciones de usuario. [Referencia del aviso](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable). Protección de contraseñas filtradas no está activada en este laboratorio gratuito con cuentas ficticias: [referencia](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection).

Regresiones locales aprobadas: STAGING-QA; proxy9/9; integración PE20/20; buscador/caret móvil y escritorio; carga inicial paralela21lecturas. Ninguna regresión accedió a producción.
