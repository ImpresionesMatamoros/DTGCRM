# Provenance specification

La unidad mínima es SourceCell: source_file, workbook_sha256, source_sheet, source_row (1-based), source_column (1-based), source_cell (A1), raw_value, normalized_value, data_type, formula, cached_value y number_format.

La identidad comprobable del workbook es su SHA-256 completo, con nombre literal/versionado como etiqueta humana. profile.workbook_properties conserva title/version si existen. El número de versión del nombre no sustituye al hash.

RawRecord enlaza batch_id y conserva source. Candidate incorpora la procedencia de su fila y la de todos los joins realizados: padre, etiquetas, listas y condiciones. PriceEvidence histórica incorpora fila de precio y condiciones. Cada valor de opción también conserva su record_id de LISTAS.

Para rastrear un precio: candidate_id → record_ids → PRECIOS y CONDICIONES_PRECIO → source_file/hash → sheet/cell → raw_value. Para ver un cambio: drift.before_id / after_id → registros de cada workbook. Para formular una decisión: issue.record_id → source; no se depende de texto libre como única ubicación.

Los IDs de importación son estables para el mismo archivo y coordenada, pero no son identidad comercial a través del tiempo. IDs legacy absorbidos y objetos originales embebidos en Notas se preservan textualmente sin auto-interpretar fusiones. Un futura decisión de fusión debe conservar ambos linajes y adjuntar una decisión explícita.

No se consideran evidencia autorizante: popularidad de una moneda, una fórmula sin evaluación, color de celda, nombre de familia, precio de benchmark o estado de un fixture TEST.

La conservación RAW es semántica a nivel de celda, no una reconstrucción byte a byte del XML: fechas se convierten a ISO. Los archivos fuente y hashes son el mecanismo para recuperar la representación OOXML exacta. No se modifica ningún Excel.
