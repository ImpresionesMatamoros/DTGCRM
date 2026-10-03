# Catálogo

## Buscar e inspeccionar

`/admin/catalog` busca en el servidor por nombre, código DTG o LEGACY_ID, y filtra por tipo, estado (incluido "sin asignar"), categoría (incluida "sin categoría") y política de decoración.

El detalle muestra:

- **Identidad**: UUID, código público, tipo y fechas. Todo inmutable.
- **Opciones**: definición, tipo, obligatoria, modo, distribuible y valores permitidos. Sin Variant ni combinaciones.
- **Decoración**: la política y, para cada método del dominio, si el item declara capacidad. Una capacidad de decoración (el cliente elige decorar con ese método) no es el proceso con que se fabrica el producto.
- **Composición**: padre → hijo × cantidad con rol INCLUDED/OPTIONAL, en ambos sentidos. Editarla queda fuera de STEP 06.
- **Presentaciones**, **resumen de precios** (por libro, modelo y estado), políticas de mercado.
- **Procedencia**: `source_reference`, más los candidatos de importación que lo crearon o vincularon.
- **Historial**: `change_event` del item y de su categoría, con actor y contexto.

## Crear (mínimo)

| Campo                | Obligatorio  | Nota                                                                             |
| -------------------- | ------------ | -------------------------------------------------------------------------------- |
| Nombre               | sí           |                                                                                  |
| Tipo                 | sí           | PRODUCT / SERVICE                                                                |
| Estado de catálogo   | sí           | **Sin preselección.** `null` es sólo para migración (ADR-0002)                   |
| Política decoración  | sí           | **Sin preselección.** El default de la base (`NONE`) sería un default silencioso |
| Artículo del cliente | sólo SERVICE | NOT_APPLICABLE / ALLOWED / REQUIRED                                              |
| Categoría            | no           | Primaria                                                                         |
| Unidad de venta      | no           | `null` = sin precio automático                                                   |
| Descripción interna  | no           |                                                                                  |

El código `DTG-xxxxx` lo asigna la secuencia de la base al insertar. Opciones, decoración, composición y precios se asocian después (por importación o en pasos futuros).

## Editar

Campos seguros: nombre, estado, unidad de venta, política de decoración, artículo del cliente (sólo SERVICE), descripción interna y categoría primaria.

Protecciones (servidor, más triggers de la base):

- `id`, `public_code` y `kind` no están en el esquema de edición: un intento se rechaza. El trigger también lo impide.
- El estado nunca vuelve a `null`.
- `NONE` se rechaza si el item tiene capacidades de decoración.
- Artículo del cliente distinto de NOT_APPLICABLE en un PRODUCT se rechaza.
- Los precios no se editan aquí.

Cada cambio queda en `change_event` con `changed_by` = actor y `context` = `admin:catalog.create` o `admin:catalog.update`.
