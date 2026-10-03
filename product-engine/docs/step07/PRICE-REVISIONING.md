# Revisiones de precio

Cada definición pertenece a un `lineage_id` con `version` creciente; `supersedes_id` / `superseded_by_id` / `superseded_at` forman la cadena. Índices únicos: `(lineage_id, version)` y un solo sucesor por predecesor. `price_definition_superseded_complete` exige datos completos en SUPERSEDED.

Autorizar la revisión N+1: cierra el predecesor (`valid_to` NULL→valor, única mutación permitida), lo marca SUPERSEDED y activa la nueva. Funciones: `cloneAuthorizedToDraft` (validFrom por defecto = siguiente minuto entero posterior a max(ahora, inicio origen + 60 s)), `compareRevisions`, `lineageOf`, `priceHistory`.

Trade-off documentado: la inmutabilidad impide “corregir” in situ un precio vigente; se corrige con revisión futura. No hay supersesión retroactiva (se bloquea como `RETROACTIVE_SUPERSESSION`).
