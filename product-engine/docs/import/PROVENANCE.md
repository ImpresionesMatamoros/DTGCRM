# Procedencia en dos capas

1. **Procedencia de importación (granular, STEP 05A)** — se conserva completa en staging: `import_record.source_cells` guarda por celda `source_file`, `workbook_sha256`, hoja, fila, columna, celda A1, `raw_value`, `normalized_value`, `data_type`, `formula`, `cached_value`, `number_format`. No se reemplaza por `SourceReference`.
2. **Procedencia de dominio** — al publicar, el adaptador agrega `source_reference` a la entidad:
   - `LEGACY_ID` (p. ej. `MIG1-O-009`): índice de linaje; nunca identidad.
   - `EXCEL_ROW` con localizador `archivo!HOJA!A12:AP12` y `payload` `{ importBatchId, importCandidateId, importRecordId, recordKey, workbookSha256, legacyId }`.
   - `HISTORICAL_PRICE_EVIDENCE` para los precios históricos del item (localizador `archivo!PRECIOS[MIG1-P-003]`), nunca `price_definition`.

`import_candidate_link` une ambas capas: candidato → entidad (`CREATED` / `LINKED_EXISTING`, rol: `catalog_item`, `item_option`, `option_value`, `decoration_capability`, `decoration_policy`, `composition_line`, `price_definition`, `presentation`).

## En ambos sentidos

```ts
traceCandidate(db, candidateId); // candidato → registros → celdas, y → entidades enlazadas
traceEntity(db, 'price_definition', id); // entidad → candidatos → registros → celdas
```

Ejemplo verificado en pruebas: la definición autorizada "Tarjeta Premium 2 caras" → candidato PRICE → 10 registros `PRECIOS` → la celda con `raw_value = 120`; y desde el candidato → la definición. El dominio conserva 10 `EXCEL_ROW` con el id del candidato.

## Identidad

- El código público `DTG-00001` se asigna **sólo** al insertar el `catalog_item` en la publicación (secuencia de la base). El parser, el envelope y staging nunca lo generan.
- El SKU y el id legacy son procedencia. Un nombre de Excel nunca es identidad.
- Claves de staging (`record_key`, `candidate_key`) son deterministas (SHA-256 truncado) y locales al lote.
