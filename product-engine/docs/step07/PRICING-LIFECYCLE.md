# Ciclo de vida de precios (STEP 07)

Estados: **DRAFT → AUTHORIZED → SUPERSEDED**. Un precio autorizado es inmutable (trigger de 0013/0015); cambiar un precio = crear una _revisión_.

- **DRAFT**: editable (matriz, breaks, condiciones, vigencia), borrable, simulable sin afectar cotización real.
- **AUTHORIZED**: vigente según `[valid_from, valid_to)`. Sólo lo escribe `authorizePriceRevision` (capability `price.authorize`).
- **SUPERSEDED**: reemplazado por una revisión posterior; conserva su intervalo cerrado para poder reproducir cotizaciones pasadas (ADR-0017).

Flujo UI: `/admin/pricing` (lista con filtros) → definición → _Clonar a borrador_ → editar → _Simular_ / _Comparar_ / _Impacto_ / _Conflictos_ → _Autorizar_. Nada de esto publica datos REAL ni toca Supabase remoto.
