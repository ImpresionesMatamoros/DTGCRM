# DTG CRM — evaluación de staging

Fecha: 2026-10-02. Evaluación terminada antes de modificar ramas o infraestructura.

## Base comprobada

- Repositorio público: `ImpresionesMatamoros/DTGCRM`.
- Rama examinada: `main`; HEAD `d5b2354f1cd11a1968bdaf1ede066a85b00619f2`.
- Checkout de evaluación limpio. No hay AGENTS.md en este checkout.
- No existe rama remota `staging` al evaluar.
- Despliegues GitHub recientes: ambiente `github-pages`, ref `main`. El repositorio declara `has_pages=true`; el endpoint público de configuración Pages devuelve 404, así que carpeta, dominio personalizado y permisos exactos requieren revisión del propietario. No hay workflow de deployment versionado en este HEAD. No se cambiará Pages.
- La API enumera un workflow de exportación STEP 10 en el repositorio, pero no está en el árbol de este HEAD. No es evidencia de despliegue de STEP 10.

## Aplicación y conexiones

Aplicación estática: `index.html`, scripts/CSS locales, manifest y `sw.js`. Supabase JS 2.45.4 desde jsDelivr; fuentes desde Google Fonts. No servidor/build configurado en la rama evaluada.

`index.html` contiene URL y clave **publishable** de Supabase directamente. Proyecto CRM de producción: `jpjpnxamiclvhmcywyhx`, nombre `DesignToGoCRM`, ACTIVE_HEALTHY. La clave pública no es un secreto, pero no debe reutilizarse en staging. No hay archivos `.env` ni `supabase/config.toml` versionados.

Auth, perfiles activos, PostgREST/RPC, Realtime y Storage utilizan el mismo cliente Supabase. Sesiones recordadas incluyen claves de almacenamiento derivadas del proyecto. Deben separarse también origen web y almacenamiento del navegador.

Consulta de inventario de proyectos (sin leer tablas de producción): no se encontró un proyecto CRM STAGING ni PE STAGING identificable. Los demás proyectos accesibles están inactivos y tienen otros nombres; no se reutilizan ni se suponen de pruebas.

## Storage

- `ticket-files`: imágenes de tickets, biblioteca, logos y fotos de equipo.
- `chat-private`: adjuntos, imágenes y audio de conversaciones privadas.
- `profile-avatars`: fotos de miembros.

Staging necesita buckets nuevos en su proyecto, con políticas equivalentes; sin copiar objetos, URLs firmadas ni archivos privados.

## Funciones y efectos externos

| Componente | Evidencia en código | Tratamiento en staging |
|---|---|---|
| `push-fanout` | `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, web-push; VAPID y webhook secret en configuración DB | No desplegar la implementación emisora; stub desactivado. No crear claves VAPID ni suscripciones |
| `transcribe-chat-audio` | `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `OPENAI_API_KEY`; llamada a OpenAI | Stub desactivado, sin clave ni consumo externo |
| Service worker | Recibe push y abre conversaciones; sin cache/fetch handler | Sustituirlo en artefacto staging por worker inerte; impedir registro y permisos push |
| WhatsApp | Enlaces `https://wa.me/` | Bloquear enlaces/ventanas; no API WhatsApp activa identificada |
| Email/teléfono | `mailto:` y `tel:` en contactos | Bloquear apertura externa; no proveedor de envío de email identificado |
| Pagos | Registros internos de pagos; no Stripe/checkout bancario identificado | UI con datos ficticios; bloquear endpoints de proveedores externos |
| Webhooks | Plumbing de push en SQL, configuración y función | Auditar triggers/jobs/config del esquema inicial; mantener desactivados |
| AI Bridge | Función dormida en UI | No habilitarla ni añadir credenciales |
| Product Engine | No está integrado en este HEAD | Reutilizar STEP 10 del ZIP, adaptar conflictos sin rehacer el motor |
| Auth email/SMS | Lo puede emitir Supabase Auth fuera del frontend | Usuarios ficticios por Admin API con email confirmado; bloquear recuperación/alta UI; sin SMTP/SMS externos |

Las funciones listadas son archivos encontrados en Git, no una afirmación de que estén desplegadas. No se inspeccionaron secretos de producción.

## STEP 10 entregado

ZIP `DTG_STEP10_CLOSEOUT_COMPLETE.zip`: PE `e83a6daca721067c462fef50896c98730d33d353`, CRM entregado `9a748cdec9b4e8d3a994373de781c51fdded167d`, integración basada en upstream `4c1d50b32d2f5e10657dbc94b6f635ad226909c5`.

Incluye picker, proxy, snapshot inmutable, dos RPCs, contrato y pruebas. No fue desplegado en infraestructura real según su informe. `git apply --check` contra nuestro HEAD falla en `index.html`; hay que integrar preservando los cambios recientes, especialmente el buscador y carga paralela.

## Bloqueo de reproducibilidad del esquema

Las migraciones versionadas son incrementales: la primera ya usa tablas/funciones preexistentes. No hay CREATE inicial de todas las tablas del CRM. `ASTRA-01-communications.sql` y `ASTRA-02-work-orders.sql` están fuera del historial de migraciones. Por tanto, no basta con `supabase db push` sobre un proyecto vacío.

Se requiere un baseline de **esquema solamente**, revisado para retirar credenciales, datos, llamadas externas, triggers emisores y jobs. No se descargará una copia de datos de producción ni se ejecutará reset remoto. Las migraciones posteriores deben reconciliarse con el baseline (evitar reaplicarlas dos veces). Esto quedará como acción explícita del propietario, con tooling de preflight.

## Recursos separados necesarios

1. Rama persistente `staging` en el mismo repo, basada en HEAD comprobado.
2. Hosting/origen separado del Pages productivo; este trabajo no puede publicar staging sobre el único sitio Pages actual.
3. Proyecto Supabase CRM staging: DB, Auth, Storage, Realtime, funciones y secretos propios.
4. Servicio PE staging con HTTPS y token propio.
5. Proyecto Supabase PE staging (DB separada); catálogo comercial revisado, sin copiar datos personales.
6. GitHub Environment `staging`, limitado a la rama; variables/secrets propios y token de administración de alcance restringido.
7. Usuarios ficticios confirmados, fixtures explícitos, sin SMTP/SMS/push/webhooks productivos.

## Resultado y límites

Assessment COMPLETE. Producción no modificada. Es viable preparar código, artefactos, scripts y workflow sin infraestructura real. No existen aún URLs/IDs/credenciales staging verificadas: se usarán placeholders visibles, arranque fail-closed y deploy desactivado hasta configuración. Ninguna prueba de integración local equivale a STEP 10 probado en staging remoto.

Referencias revisadas: Supabase changelog (2026-10-02), https://supabase.com/docs/guides/deployment/managing-environments y https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/manage-environments . La actualización Postgres 15.19/17.11 debe revisarse al crear los proyectos; el inventario actual muestra Postgres 17.6 y no se actualiza producción.
