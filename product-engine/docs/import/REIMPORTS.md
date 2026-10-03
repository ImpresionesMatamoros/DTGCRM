# Idempotencia y reimportaciones

## Misma fuente

Identidad de una corrida: `source_sha256 + parser_version + contract_version + data_class + fixture_name` (+ `attempt`).

| Caso                                     | Resultado                                                                                   |
| ---------------------------------------- | ------------------------------------------------------------------------------------------- |
| Mismo envelope otra vez                  | `ALREADY_STAGED`: devuelve el lote existente; no se escribe nada                            |
| Mismo envelope con `--rerun`             | Nuevo intento (`attempt = n+1`, `rerun_of_batch_id`); candidatos `UNCHANGED` por linaje     |
| Envelope distinto con la misma identidad | Error (`StagingError`): el exportador/parser no fue determinista o cambió sin subir versión |

Las claves de registro/candidato son deterministas (hash de workbook + hoja + fila; hash de la firma del grupo de precio), así que dos corridas del mismo archivo producen las mismas claves.

## Nueva versión del workbook

`v1 → lote A`, `v2 → lote B`: B es un lote nuevo con `previous_batch_id = A`. **B no borra ni modifica A** (la base impide borrar historia). Cada candidato de B se concilia con A por `lineage_key` (tipo + id legacy o firma del precio), nunca por coordenada:

- `NEW` — no existía en el lote anterior del mismo linaje.
- `UNCHANGED` — misma propuesta (`payload_sha256`).
- `CHANGED` — misma identidad lógica, propuesta distinta (p. ej. cambió un importe).

Linaje por defecto: el catálogo principal comparte `workbook:PRIMARY_RC` entre versiones; comparación y evidencia especializada usan `workbook:<rol>:<archivo>`; fixtures `fixture:<nombre>`. Se puede fijar con `--lineage`.

## Aprobaciones y dominio

- Una aprobación pertenece a un candidato de un lote: los candidatos de B nacen sin aprobar aunque A estuviera publicado.
- Publicar B nunca duplica el dominio: el linaje `LEGACY_ID` hace que `CREATE` falle con `LINEAGE_EXISTS`; se usa `LINK_EXISTING` para conciliar. Precios: `PRICE_DEFINITION_EXISTS` obliga a enlazar (o, en una etapa futura, a versionar con `supersedes_id`).
- `traceEntity` muestra todas las corridas que respaldan una entidad, en orden.
