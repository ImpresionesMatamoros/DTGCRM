# STEP 08 — Catálogo de reglas de calidad

Generado desde `src/quality/rules.ts` (52 reglas, versión 1). No editar a mano: `pnpm quality:report`.

## Semántica

- **Código estable** `DQ-<ÁREA>-NNN`: nunca se reutiliza con otro significado; si la semántica cambia sustancialmente se sube la `versión` de la regla y se documenta aquí.
- **Severidad**: BLOCKER = el objeto no puede considerarse listo para publicar/migrar; WARNING = conviene corregir; INFO = informativo.
- **Remediación**: BULK_RESOLVABLE (campo con herramienta masiva), MANUAL_REVIEW, OWNER_DECISION_REQUIRED (una decisión ligada está abierta y el artículo está en su alcance; **no es un error técnico**), SOURCE_FIX (corregir el Excel). Al registrarse una respuesta, la regla vuelve a su remediación propia.
- **Dimensión**: REVIEW, DOMAIN o PRICING (la publicación se deriva: depende de las tres, de decisiones bloqueantes abiertas y de la barrera de publicación REAL).
- Los precios históricos (23) son evidencia: sólo generan hallazgos si intentan alimentar precios vigentes.
- Solapamiento documentado: **DQ-CATALOG-003** (artículo sin unidad de venta) y **DQ-PRICE-003** (precio que depende de una unidad de venta ausente) miran la misma unidad desde lados distintos; ambos se resuelven con el mismo campo masivo `saleUnit` y se deduplican por clave (regla+sujeto), no entre reglas.
- México: no se cierra IVA/D-022; HALF_UP_2 sigue siendo "PROVISIONAL TECHNICAL BEHAVIOR" (DQ-PRICE-015/016).

## Reglas

| Código         | v   | Área         | Dim.    | Sev.    | Título                                              | Remediación             | Campo masivo                      | Decisiones   |
| -------------- | --- | ------------ | ------- | ------- | --------------------------------------------------- | ----------------------- | --------------------------------- | ------------ |
| DQ-CATALOG-001 | 1   | CATALOG_ITEM | REVIEW  | BLOCKER | Producto/Servicio sin resolver                      | BULK_RESOLVABLE         | CATALOG_ITEM.itemType             | D-003        |
| DQ-CATALOG-002 | 1   | CATALOG_ITEM | REVIEW  | BLOCKER | Estado de catálogo sin resolver                     | BULK_RESOLVABLE         | CATALOG_ITEM.status               | D-001        |
| DQ-CATALOG-003 | 1   | CATALOG_ITEM | DOMAIN  | BLOCKER | Unidad de venta ausente                             | BULK_RESOLVABLE         | CATALOG_ITEM.saleUnit             | D-002        |
| DQ-CATALOG-004 | 1   | CATEGORY     | DOMAIN  | WARNING | Categoría sin mapear                                | BULK_RESOLVABLE         | CATALOG_ITEM.categoryKey          | D-009        |
| DQ-CATALOG-005 | 1   | CATALOG_ITEM | REVIEW  | BLOCKER | Política de decoración sin resolver                 | BULK_RESOLVABLE         | CATALOG_ITEM.decorationPolicy     | —            |
| DQ-CATALOG-006 | 1   | CATALOG_ITEM | REVIEW  | BLOCKER | Material del cliente sin resolver (servicio)        | BULK_RESOLVABLE         | CATALOG_ITEM.customerSuppliedItem | D-013        |
| DQ-CATALOG-007 | 1   | CATALOG_ITEM | DOMAIN  | WARNING | Posible duplicado                                   | MANUAL_REVIEW           | —                                 | —            |
| DQ-CATALOG-009 | 1   | CATEGORY     | DOMAIN  | BLOCKER | Categoría resuelta inexistente                      | MANUAL_REVIEW           | —                                 | —            |
| DQ-COMP-001    | 1   | COMPOSITION  | DOMAIN  | BLOCKER | Composición sin padre o sin hijo                    | MANUAL_REVIEW           | —                                 | —            |
| DQ-COMP-002    | 1   | COMPOSITION  | DOMAIN  | BLOCKER | Hijo de composición aún no utilizable               | MANUAL_REVIEW           | —                                 | —            |
| DQ-COMP-003    | 1   | COMPOSITION  | DOMAIN  | BLOCKER | Relación circular                                   | SOURCE_FIX              | —                                 | —            |
| DQ-COMP-004    | 1   | COMPOSITION  | REVIEW  | BLOCKER | Cantidad de composición ausente o inválida          | MANUAL_REVIEW           | —                                 | —            |
| DQ-COMP-005    | 1   | COMPOSITION  | REVIEW  | BLOCKER | Incluido/Opcional sin resolver                      | MANUAL_REVIEW           | —                                 | —            |
| DQ-DECOR-001   | 1   | DECORATION   | REVIEW  | BLOCKER | Método de decoración sin clasificar                 | BULK_RESOLVABLE         | DECORATION.methodKey              | D-006        |
| DQ-DECOR-002   | 1   | DECORATION   | DOMAIN  | BLOCKER | Método de decoración desconocido                    | MANUAL_REVIEW           | —                                 | —            |
| DQ-DECOR-003   | 1   | DECORATION   | DOMAIN  | BLOCKER | Decoración sin item válido                          | SOURCE_FIX              | —                                 | —            |
| DQ-DECOR-004   | 1   | DECORATION   | DOMAIN  | WARNING | Asociación de decoración duplicada                  | MANUAL_REVIEW           | —                                 | —            |
| DQ-IMPORT-001  | 1   | IMPORT       | REVIEW  | BLOCKER | Candidate bloqueado por el importador               | SOURCE_FIX              | —                                 | —            |
| DQ-OPTION-001  | 1   | OPTION       | REVIEW  | BLOCKER | Opción obligatoria sin resolver                     | BULK_RESOLVABLE         | OPTION.isRequired                 | D-004        |
| DQ-OPTION-002  | 1   | OPTION       | REVIEW  | BLOCKER | Definición de opción sin resolver / nombre genérico | MANUAL_REVIEW           | —                                 | D-005        |
| DQ-OPTION-003  | 1   | OPTION       | REVIEW  | BLOCKER | Modo de selección sin resolver                      | BULK_RESOLVABLE         | OPTION.selectionMode              | D-004        |
| DQ-OPTION-004  | 1   | OPTION       | REVIEW  | BLOCKER | Distribuible sin resolver                           | BULK_RESOLVABLE         | OPTION.isDistributable            | D-007        |
| DQ-OPTION-005  | 1   | OPTION       | REVIEW  | BLOCKER | Valores de opción sin mapear                        | MANUAL_REVIEW           | —                                 | D-005        |
| DQ-OPTION-006  | 1   | OPTION       | DOMAIN  | BLOCKER | OptionDefinition duplicada o en conflicto           | MANUAL_REVIEW           | —                                 | —            |
| DQ-OPTION-007  | 1   | OPTION       | DOMAIN  | WARNING | Opción duplicada en el mismo item                   | MANUAL_REVIEW           | —                                 | —            |
| DQ-OPTION-008  | 1   | OPTION       | DOMAIN  | WARNING | Valores de opción repetidos (origen)                | MANUAL_REVIEW           | —                                 | —            |
| DQ-OPTION-009  | 1   | OPTION       | DOMAIN  | BLOCKER | Valores de opción resueltos duplicados              | MANUAL_REVIEW           | —                                 | —            |
| DQ-OPTION-010  | 1   | OPTION       | DOMAIN  | BLOCKER | Valores incompatibles con el tipo de opción         | MANUAL_REVIEW           | —                                 | —            |
| DQ-PRES-001    | 1   | PRESENTATION | REVIEW  | BLOCKER | Presentación sin idioma                             | BULK_RESOLVABLE         | PRESENTATION.locale               | —            |
| DQ-PRES-002    | 1   | PRESENTATION | REVIEW  | BLOCKER | Presentación default sin resolver                   | BULK_RESOLVABLE         | PRESENTATION.isDefault            | —            |
| DQ-PRES-003    | 1   | PRESENTATION | DOMAIN  | BLOCKER | Presentación sin item                               | SOURCE_FIX              | —                                 | —            |
| DQ-PRES-004    | 1   | PRESENTATION | DOMAIN  | WARNING | Presentaciones duplicadas                           | MANUAL_REVIEW           | —                                 | —            |
| DQ-PRES-005    | 1   | PRESENTATION | DOMAIN  | BLOCKER | Más de una presentación default                     | MANUAL_REVIEW           | —                                 | —            |
| DQ-PRICE-001   | 1   | PRICING      | PRICING | WARNING | Evidencia de precio sin PriceDefinition             | MANUAL_REVIEW           | —                                 | —            |
| DQ-PRICE-002   | 1   | PRICING      | PRICING | WARNING | PriceDefinition aún en DRAFT                        | MANUAL_REVIEW           | —                                 | —            |
| DQ-PRICE-003   | 1   | PRICING      | PRICING | BLOCKER | Item con precio pero sin unidad de venta            | BULK_RESOLVABLE         | CATALOG_ITEM.saleUnit             | D-002        |
| DQ-PRICE-004   | 1   | PRICING      | PRICING | BLOCKER | Precio sin moneda                                   | SOURCE_FIX              | —                                 | —            |
| DQ-PRICE-005   | 1   | PRICING      | PRICING | BLOCKER | Semántica de cantidad/base sin resolver             | MANUAL_REVIEW           | —                                 | D-010, D-011 |
| DQ-PRICE-006   | 1   | PRICING      | PRICING | BLOCKER | Evidencia histórica usada como precio actual        | SOURCE_FIX              | —                                 | —            |
| DQ-PRICE-007   | 1   | PRICING      | PRICING | BLOCKER | Definiciones de precio traslapadas                  | MANUAL_REVIEW           | —                                 | —            |
| DQ-PRICE-008   | 1   | PRICING      | PRICING | WARNING | Cantidad esperada sin cobertura                     | MANUAL_REVIEW           | —                                 | —            |
| DQ-PRICE-009   | 1   | PRICING      | PRICING | BLOCKER | Vigencia del precio sin decidir                     | BULK_RESOLVABLE         | PRICE.validFrom                   | —            |
| DQ-PRICE-010   | 1   | PRICING      | PRICING | BLOCKER | D-008 · alcance del recargo por talla               | OWNER_DECISION_REQUIRED | —                                 | D-008        |
| DQ-PRICE-011   | 1   | PRICING      | PRICING | BLOCKER | D-010 · varios pares de imanes                      | OWNER_DECISION_REQUIRED | —                                 | D-010        |
| DQ-PRICE-012   | 1   | PRICING      | PRICING | BLOCKER | D-011 · tarifas de Yard Sign                        | OWNER_DECISION_REQUIRED | —                                 | D-011        |
| DQ-PRICE-013   | 1   | PRICING      | PRICING | BLOCKER | D-016 · autoridad para autorizar/publicar precios   | OWNER_DECISION_REQUIRED | —                                 | D-016        |
| DQ-PRICE-014   | 1   | PRICING      | PRICING | BLOCKER | D-022 · IVA / impuestos México sin resolver         | OWNER_DECISION_REQUIRED | —                                 | D-022        |
| DQ-PRICE-015   | 1   | PRICING      | PRICING | WARNING | Evidencia de México sin política de mercado         | MANUAL_REVIEW           | —                                 | D-022        |
| DQ-PRICE-016   | 1   | PRICING      | PRICING | INFO    | Redondeo HALF_UP_2 provisional (México)             | OWNER_DECISION_REQUIRED | —                                 | D-022        |
| DQ-PROV-001    | 1   | PROVENANCE   | REVIEW  | BLOCKER | Candidate sin registro fuente                       | SOURCE_FIX              | —                                 | —            |
| DQ-PROV-002    | 1   | PROVENANCE   | REVIEW  | BLOCKER | Registro sin hoja/fila/celda                        | SOURCE_FIX              | —                                 | —            |
| DQ-PROV-003    | 1   | PROVENANCE   | DOMAIN  | WARNING | Objeto de dominio sin rastro                        | MANUAL_REVIEW           | —                                 | —            |

## Descripciones

- **DQ-CATALOG-001** — La columna Clase está vacía o sin mapear: PRODUCT o SERVICE debe decidirse explícitamente.
- **DQ-CATALOG-002** — Sin CatalogStatus un item nunca se ofrece ni se publica. Nunca se asigna por defecto.
- **DQ-CATALOG-003** — Sin unidad de venta no hay precio automático. “Sin unidad” (null) es una decisión explícita; no se inventan unidades.
- **DQ-CATALOG-004** — La categoría del Excel es sólo evidencia: nunca se asigna sola. Se resuelve con una categoría existente de Product Engine.
- **DQ-CATALOG-005** — El Excel nunca dice NONE/OPTIONAL/REQUIRED: siempre es una decisión.
- **DQ-CATALOG-006** — “Acepta material del cliente = Sí” no distingue ALLOWED de REQUIRED. Sólo aplica a SERVICE.
- **DQ-CATALOG-007** — El importador señaló dos items que podrían ser el mismo. Se revisa lado a lado; nunca se fusiona. DISTINCT lo silencia, REVIEWED lo baja a INFO.
- **DQ-CATALOG-009** — El borrador apunta a una categoría que no existe en el dominio.
- **DQ-COMP-001** — Falta uno de los dos extremos de la relación.
- **DQ-COMP-002** — El item hijo no existe entre los candidates o fue rechazado/bloqueado por el importador.
- **DQ-COMP-003** — La cadena padre → hijo vuelve al mismo item.
- **DQ-COMP-004** — La cantidad del hijo por unidad del padre debe ser un entero positivo y explícito.
- **DQ-COMP-005** — INCLUDED u OPTIONAL: el Excel no lo dice.
- **DQ-DECOR-001** — Una asociación de proceso de producción no prueba que sea una decoración elegible por el cliente: debe confirmarse el método (o excluirse).
- **DQ-DECOR-002** — El methodKey resuelto no existe en los métodos del dominio.
- **DQ-DECOR-003** — La asociación apunta a un item que no existe entre los candidates o fue rechazado.
- **DQ-DECOR-004** — Mismo item y mismo método más de una vez.
- **DQ-IMPORT-001** — El candidate nunca podrá aprobarse sin corregir la fuente (modelo no soportado, importe inválido, bundle, etc.). Las razones ya cubiertas por reglas específicas no se repiten.
- **DQ-OPTION-001** — La columna Obligatoria vacía queda sin resolver: nunca se asume “no”.
- **DQ-OPTION-002** — Una definición por significado (tamano_papel ≠ tamano_display). Los nombres genéricos (color, tamano, acabado, modelo) exigen mapeo explícito.
- **DQ-OPTION-003** — SINGLE o MULTI: el Excel no lo dice.
- **DQ-OPTION-004** — Si la opción puede variar entre renglones de una cantidad. Sólo SINGLE + ENUM.
- **DQ-OPTION-005** — Cada valor del Excel debe usar un valor existente, crear uno o excluirse con motivo.
- **DQ-OPTION-006** — Dos candidates crean la misma clave con significado distinto, o una “nueva” definición ya existe en el dominio (hay que usar EXISTING).
- **DQ-OPTION-007** — Dos candidates de opción del mismo item con el mismo nombre normalizado.
- **DQ-OPTION-008** — Dos valores del Excel de una misma opción tienen la misma etiqueta normalizada.
- **DQ-OPTION-009** — Dos valores del Excel se resolvieron al mismo código de OptionValue.
- **DQ-OPTION-010** — La forma del valor (ancho×alto, cantidad, longitud, texto) no corresponde al tipo de la definición elegida o la definición EXISTING no existe.
- **DQ-PRES-001** — El Excel no dice es/en: la presentación queda sin mapear.
- **DQ-PRES-002** — A lo sumo una default por item e idioma; debe elegirse.
- **DQ-PRES-003** — La presentación no apunta a ningún item existente.
- **DQ-PRES-004** — Mismo item, mismo nombre visible e idioma efectivo.
- **DQ-PRES-005** — Dos presentaciones marcadas default para el mismo item e idioma.
- **DQ-PRICE-001** — El Excel trae precio actual pero no existe ninguna PriceDefinition del dominio. Es el estado esperado antes de migrar; se crea un BORRADOR con el editor de STEP 07 (nunca se autoriza solo).
- **DQ-PRICE-002** — El precio existe pero nadie lo ha autorizado (STEP 07 lifecycle).
- **DQ-PRICE-003** — No puede haber precio automático sin unidad de venta (ni se inventa una).
- **DQ-PRICE-004** — La moneda del precio no se pudo determinar de la fuente.
- **DQ-PRICE-005** — El precio no dice a qué cantidad exacta aplica o si el importe es TOTAL o UNIT. No se asume umbral ni cantidad.
- **DQ-PRICE-006** — Un precio histórico (sólo evidencia) alimenta un candidate de precio actual o una definición. Los históricos NO son defectos mientras sean evidencia.
- **DQ-PRICE-007** — Dos definiciones vivas del mismo alcance se traslapan (price_definition_find_clash, STEP 07).
- **DQ-PRICE-008** — La evidencia trae cantidades que la matriz AUTORIZADA no cubre: esas cantidades cotizan sólo bajo petición.
- **DQ-PRICE-009** — validFrom nunca se asume “ahora”: es una decisión explícita.
- **DQ-PRICE-010** — El recargo 2XL/3XL sólo existe donde ya estaba asignado; extenderlo requiere la decisión del owner.
- **DQ-PRICE-011** — 1 par tiene precio fijo; varios pares siguen en QUOTE_ONLY hasta que el owner decida.
- **DQ-PRICE-012** — Moneda y semántica de cantidad (exacta vs umbral) sin definir; es evidencia, no PriceDefinition.
- **DQ-PRICE-013** — No está definido quién autoriza precios en producción. Sólo existe la capacidad técnica price.authorize (rol local de desarrollo).
- **DQ-PRICE-014** — No se agrega ni se infiere ningún impuesto; la política fiscal de México está abierta.
- **DQ-PRICE-015** — Hay evidencia de precio de México pero el item no tiene una política de mercado MX definida.
- **DQ-PRICE-016** — El precio derivado de México usa HALF_UP_2 como PROVISIONAL TECHNICAL BEHAVIOR, no como política comercial (D-022).
- **DQ-PROV-001** — La cadena candidate → record → workbook está rota: no hay registro que respalde al candidate.
- **DQ-PROV-002** — Un registro fuente no puede rastrearse a hoja, fila y celda del workbook.
- **DQ-PROV-003** — Un artículo del dominio no tiene evidencia de origen ni evento de auditoría con actor. Lo creado a mano debe tener al menos el actor.
