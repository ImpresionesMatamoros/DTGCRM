# Laboratorio operativo — 3 octubre 2026

Un único proyecto Supabase **DTG CRM STAGING** (`hhzqmqndavqqswerjhxe`) aloja todo el laboratorio. El propietario autorizó esta arquitectura después del límite de proyectos gratuitos. Producción permanece en otro proyecto y en main, sin cambios.

- CRM: esquema `public`, Auth propio y tres buckets privados.
- Product Engine: esquema privado `dtg_pe`, rol de lectura `dtg_pe_runtime`, sin acceso a tickets. Catálogo consultado exclusivamente por la API original STEP 10.
- Engine y proxy: Supabase Edge Functions del mismo proyecto. El proxy valida la sesión y la pertenencia activa; el engine exige un token de servicio distinto. El navegador no conoce el token ni la contraseña del rol.
- Vault: exactamente dos secretos nuevos del laboratorio; una RPC accesible solo a service_role los entrega al runtime.
- Frontend privado: https://dtg-crm-laboratorio.gatete2025.chatgpt.site
- Datos CRM ficticios. Baseline reconstruido a partir de metadatos, nunca de filas productivas. No se copiaron claves, usuarios, mensajes ni suscripciones push.
- WhatsApp, correo, push, pagos, webhooks y transcripción externa apagados.

Los archivos de `product-engine/` preservan el motor entregado. `staging/engine-entry.ts` y las funciones Edge son adaptadores de alojamiento; las reglas de precio, contratos y snapshots no fueron sustituidas.

El catálogo cargado es el dev-slice entregado: 16 artículos, 12 activos visibles. No representa la importación comercial definitiva ni una aprobación de precios para ventas reales.
