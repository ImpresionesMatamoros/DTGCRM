# Modelo de dominio implementado

Código en `src/domain`. Refleja el modelo conceptual de STEP 02/03 con los ajustes de STEP 04 (`DECISIONS.md`).

## Identidad

| Concepto                           | Implementación                                                | Notas                                                                                    |
| ---------------------------------- | ------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `CatalogItem`                      | Unión `Product \| Service` con `kind`                         | Bundle conceptual, no implementado                                                       |
| `id`                               | UUID                                                          | Inmutable                                                                                |
| `publicCode`                       | `DTG-00001…`                                                  | Secuencia; inmutable; sin significado (ADR-0011)                                         |
| `status`                           | `CANDIDATE \| PLANNED \| ACTIVE \| RETIRED \| null`           | `null` = no asignado (migración). Nunca vuelve a `null`. Sólo `ACTIVE` se cotiza/publica |
| `saleUnit`                         | `PIECE, PAIR, SET, PACKAGE, SHEET, SQ_FT, LINEAR_FT` o `null` | Sin unidad no hay precio automático                                                      |
| `decorationPolicy`                 | `NONE \| OPTIONAL \| REQUIRED`                                | Blank = sin decoraciones (ADR-0004)                                                      |
| `customerSuppliedItem`             | sólo en `Service`                                             | Artículo aportado por el cliente                                                         |
| `Category` / `CatalogItemCategory` | Relación aparte, ≤1 primaria                                  | Mover de categoría no toca identidad                                                     |

## Configuración

| Concepto                        | Implementación                                                                                                                                                                                         |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `OptionDefinition`              | Clave única, `valueKind` (`ENUM, DIMENSIONS, QUANTITY, LENGTH, TEXT, BOOLEAN`), unidad si es medida, `scope` (`ITEM`/`DECORATION`). Una definición por significado (`tamano_papel` ≠ `tamano_display`) |
| `OptionValue`                   | Global por definición; `spec` estructurado (`{w,h}` o `{value}`)                                                                                                                                       |
| `ItemOption`                    | Opción habilitada en un item: requerida, `SINGLE/MULTI`, `isDistributable` (ADR-0001)                                                                                                                  |
| `ItemOptionValue`               | Subconjunto controlado de valores por item                                                                                                                                                             |
| `PriceRequest` (ConfiguredItem) | Item, mercado, cantidad, selecciones comunes, `distribution[]` (corrida de tallas), medidas, decoraciones, componentes opcionales                                                                      |
| `validateConfiguration`         | Devuelve errores tipados (`OPTION_NOT_ALLOWED`, `MISSING_OPTION`, `METHOD_NOT_COMPATIBLE`, `OPTIONAL_COMPONENT_NOT_ACTIVE`, …)                                                                         |

## Decoración y composición

- `DecorationMethod` (DTF, EMBROIDERY, SCREEN_PRINTING, HTV) es un proceso; DTF Transfer y DTF Gang Sheet son `Product`.
- `DecorationCapability` = item × método.
- `CompositionLine` padre → hijo con `INCLUDED` (precio dentro del padre) u `OPTIONAL` (el hijo se cotiza con su propio precio y política de mercado). Sin ciclos, profundidad ≤ 2. El componente es un `CatalogItem` normal.

## Mercado y precio

| Concepto           | Implementación                                                                                                                                                                 |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `Market`           | `USA`, `MX`                                                                                                                                                                    |
| `PriceBook`        | `MASTER` (USA, USD) o `DERIVED` (MX, MXN, fuente USA, factor default 0.70)                                                                                                     |
| `ItemMarketPolicy` | **Persistente**: `INHERIT \| DERIVED \| MANUAL \| QUOTE_ONLY`, `factorOverride`, `isAvailable`                                                                                 |
| `PricingParameter` | `usd_mxn_fx = 16.50`, versionado por vigencia                                                                                                                                  |
| `PriceDefinition`  | Unión por `model`: `FIXED`, `PER_UNIT`, `EXACT_QUANTITY_MATRIX`, `TIERED`, `MEASURED`; `component` `ITEM/DECORATION`; estado `DRAFT/AUTHORIZED/SUPERSEDED`; vigencia y versión |
| `PriceBreak`       | Cantidad → importe (`TOTAL`/`UNIT`)                                                                                                                                            |
| `PriceCondition`   | `OPTION_VALUE` o `DECORATION_METHOD`; AND entre opciones, IN dentro de una opción                                                                                              |
| `PriceRule`        | `ADD_PER_UNIT`, `ADD_FIXED`, `REQUIRE_QUOTE`; `exclusivityKey`; asignación explícita por item                                                                                  |
| `Money`            | `{ amount: Decimal, currency: 'USD' \| 'MXN' }`                                                                                                                                |

## Presentación, publicación y procedencia

- `Presentation`: nombre, idioma, ocasión, alias, SEO; la ocasión no crea productos.
- `PublicationProfile` + `PublicationAssignment`: `ALL_MATCHING` (CRM) o `EXPLICIT` (catálogo, listas). `isPublished` excluye siempre status `null`.
- `SourceReference` (incluye `HISTORICAL_PRICE_EVIDENCE`), `DecisionRecord` con sujetos, `ChangeEvent` (escrito por la base).

## Conceptuales sin persistencia

`Variant` (ADR-0007), `Bundle`, `SourcingOption`/`Brand`/`Supplier`.
