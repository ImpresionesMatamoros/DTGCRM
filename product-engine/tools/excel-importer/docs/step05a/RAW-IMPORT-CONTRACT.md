# Raw import contract

Contrato ejecutable de referencia: `parser/contracts.ts` (`SourceCell`, `RawRecord`, `Batch`, `Issue`). No depende de PostgreSQL, ORM, API ni dominio STEP 04. La implementación Python emite JSON compatible con esos tipos.

Un resultado por workbook contiene `batch`, `profile`, `records`, `candidates`, `historical_prices`, `duplicate_reviews`, `issues`. Un registro conserva tres cosas distintas: raw_payload, normalized_payload y source. La interpretación de dominio sólo aparece en candidates.

`raw_payload` contiene valores de columnas de negocio bajo sus cabeceras; `source` conserva además celdas auxiliares fuera de esas columnas. Las filas de referencia usan coordenadas como claves. Las fórmulas sólo tienen texto RAW; normalized_value es null y cached_value se conserva aparte. Las filas exclusivamente de fórmulas quedan en profile.sheets.formulas. Fechas tipadas se serializan en ISO y conservan data_type; no se reconstruye la cadena que Excel mostraba a partir del formato.

Ausencia de celda y cadena vacía no se equiparan: null frente a "". Para campos de negocio ausentes se construye la coordenada exacta y se registra raw_value=null. Los espacios y caracteres invisibles originales siguen en raw_value aunque normalized_value sea "". No se convierten blancos en cero, false o moneda por mayoría.

El lote informa archivo, hash, rol, versión del parser, hojas/filas inspeccionadas, registros, candidatos y conteos de severidad. rows_inspected es suma de alturas declaradas de hojas, no número de productos. raw_records incluye evidencia documental y TEST. El inicio y fin se encuentran en run-metadata.json, enlazados por batch_id.

Los issues enlazan record_id cuando existe y siempre source. Un error de cabecera ocurre antes de poder crear registros tipados y tiene record_id=null. Identificadores repetidos se reportan en cada fila; nunca se sobrescribe una fila por otra en un diccionario de IDs.

Cambios incompatibles a estructura o reglas exigen subir la versión del parser. Campos adicionales de perfiles de inspección pueden evolucionar; el bridge no debe tratarlos como campos del dominio.
