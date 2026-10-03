# Estado real del laboratorio

**Funcional y publicado**, con autenticación real, base CRM, catálogo PE, API, proxy y datos ficticios. Se utilizó el proyecto nuevo DTG CRM STAGING para ambos componentes, con esquemas separados; no se requiere tercer proyecto ni plan de pago para esta configuración.

Proyecto: `hhzqmqndavqqswerjhxe`, región us-east-1. Sitio privado: https://dtg-crm-laboratorio.gatete2025.chatgpt.site

Producción `jpjpnxamiclvhmcywyhx` y main no se modificaron. Los otros proyectos existentes no se reactivaron ni reutilizaron.

Completado: esquema CRM y RLS, STEP 10, 19 migraciones PE, seeds de desarrollo, credenciales nuevas privadas, funciones, buckets privados, usuarios ficticios confirmados, publicación y pruebas reales. Se conservan los snapshots históricos cuando cambia el catálogo y el CRM puede guardar líneas manuales si PE falla.

GitHub Actions valida staging y genera automáticamente el artefacto del frontend. La publicación inicial está realizada; publicar cada push automáticamente al hosting queda como opción preparada, sin un webhook ficticio ni credenciales permanentes añadidas. El acceso a este sitio privado corresponde al propietario de Sites; acceso compartido con el equipo se configura posteriormente.
