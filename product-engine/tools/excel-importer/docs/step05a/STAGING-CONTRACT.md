# Staging contract

`parser/contracts.ts` define Candidate como unión discriminada por kind: catalog_item, option, price, decoration, composition. Cada candidato contiene datos interpretados, lista de record_ids, todas las referencias relevantes, issue_ids, validation_state y review.

Los campos que parecen vocabulario del dominio llevan sufijo hypothesis cuando corresponde. Son propuestas trazables que STEP 04 debe aceptar o rechazar. legacy_id es exclusivamente evidencia. No hay public_code generado, UUID de Product Engine ni nombre de tabla física.

## Dos dimensiones independientes

- `workflow_state=PENDING_REVIEW` describe la fase del importador.
- `validation_state=VALID | WARNING | REJECTED` describe comprobaciones técnicas.
- `catalog_status_hypothesis` describe exclusivamente una hipótesis de lifecycle del item o null.

Un candidato técnicamente VALID sigue pendiente de revisión. No es una oferta activa ni un precio autorizado en Product Engine. Todos tienen publishable=false. La secuencia futura será Parsed → Validated → Staged → Human Review → Explicit Approval → Publish; esta entrega termina antes de las tres últimas acciones.

## Precios y evidencias

PriceEvidence contiene importe decimal como string, moneda explícita o null, extremos de cantidad, condiciones literales, estado de autorización en la fuente y current=false. historical_prices es una colección separada y no se mezcla con candidates de precio. STEP 05B debe dirigirla a la capacidad de evidencia del dominio, nunca a una definición de precio.

Las agrupaciones de evidence/price-groups.json son vistas de hipótesis. Conservan candidate_ids para llegar a cada punto y sus celdas. No son definiciones de precio persistidas. El grupo fijo de imanes conserva cantidad desconocida y no autoriza multiplicar por pares.

## Decoración, opciones y composición

Una asociación de método no prueba que se cobre decoración por separado. subtype distingue asociación y política. Las modalidades Blank/Personalizada no producen opciones redundantes. Las relaciones de componente enlazan IDs legacy como claves de revisión; el bridge resolverá identidades con cardinalidad explícita. No se materializan variantes.

Se propone aprobar candidatos mediante artefacto separado, firmado por identidad/rol/revisión de fuente, sin editar el JSON determinista. El contrato de aprobaciones y su persistencia están pendientes de STEP 04/05B; no se implementan aquí.
