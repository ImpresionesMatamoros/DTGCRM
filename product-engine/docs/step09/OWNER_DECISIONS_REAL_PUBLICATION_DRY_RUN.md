# STEP 09 completion — Ensayo de publicación REAL (decisiones del dueño)

Generado por `tsx scripts/step09-completion-report.ts pre` el 2026-10-02T09:00:47.654Z, **antes de cualquier escritura REAL** de esta pasada. Se aplicó la `OWNER_DECISION_SPEC_v1.0` a staging (decisiones, categoría, disposiciones, resoluciones); aquí se ve qué haría el permiso ampliado.

## Resultado de la compuerta item por item

| Legacy       | Item                                   | Veredicto   | Tratamiento                                | Precio         | Adaptador (ensayo)                                                                                                                                                                                                       | Razones |
| ------------ | -------------------------------------- | ----------- | ------------------------------------------ | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------- |
| MIG1-O-008   | Tarjeta Tradicional                    | PUBLISHED   | —                                          | READY          | ya publicado DTG-00001 (CATALOG_ITEM:enlaza1 OPTION:enlaza3 PRICE:enlaza1 PRICE:enlaza1)                                                                                                                                 | —       |
| MIG1-O-009   | Tarjeta Premium / Gloss                | PUBLISHED   | —                                          | READY          | ya publicado DTG-00002 (CATALOG_ITEM:enlaza1 OPTION:enlaza3 PRICE:enlaza1 PRICE:enlaza1)                                                                                                                                 | —       |
| MIG2-O-036   | Flyers                                 | PUBLISHED   | —                                          | READY          | ya publicado DTG-00003 (CATALOG_ITEM:enlaza1 OPTION:enlaza3 OPTION:enlaza3 OPTION:enlaza4 PRICE:enlaza1 PRICE:enlaza1 PRICE:enlaza1 PRICE:enlaza1 PRICE:enlaza1 PRICE:enlaza1 PRICE:enlaza1 PRICE:enlaza1 PRICE:enlaza1) | —       |
| MIG2-O-037   | Tabloides                              | PUBLISHABLE | ACTIVE · PIECE · «Poster / Tabloide 11×17» | QUOTE_ONLY     | se publicaría DTG-00034 (CATALOG_ITEM:crea1)                                                                                                                                                                             | —       |
| MIG2-O-038   | Posters                                | PUBLISHABLE | ACTIVE · SQ_FT · «Poster Gran Formato»     | QUOTE_ONLY     | se publicaría DTG-00035 (CATALOG_ITEM:crea1)                                                                                                                                                                             | —       |
| MIG2-O-039   | Menús                                  | PUBLISHABLE | ACTIVE · PIECE                             | QUOTE_ONLY     | se publicaría DTG-00036 (CATALOG_ITEM:crea1 OPTION:crea2 PRESENTATION:crea1)                                                                                                                                             | —       |
| MIG2-O-040   | Postales                               | PUBLISHED   | —                                          | QUOTE_ONLY     | ya publicado DTG-00033 (CATALOG_ITEM:crea1)                                                                                                                                                                              | —       |
| MIG2-O-046   | Tarjetas complementarias               | RESOLVED    | LEGACY_INVALID                             | NOT_APPLICABLE | no se publica                                                                                                                                                                                                            | —       |
| MIG2-O-047   | Seating card / place card              | PUBLISHABLE | CANDIDATE · PIECE                          | QUOTE_ONLY     | se publicaría DTG-00037 (CATALOG_ITEM:crea1)                                                                                                                                                                             | —       |
| MIG2-O-048   | Thank-you card                         | PUBLISHABLE | CANDIDATE · PIECE                          | QUOTE_ONLY     | se publicaría DTG-00038 (CATALOG_ITEM:crea1)                                                                                                                                                                             | —       |
| MIGF-O-008   | Invitación sencilla                    | PUBLISHABLE | ACTIVE · PIECE                             | QUOTE_ONLY     | se publicaría DTG-00039 (CATALOG_ITEM:crea1)                                                                                                                                                                             | —       |
| MIGF-O-009   | Invitación premium                     | PUBLISHABLE | ACTIVE · PIECE                             | QUOTE_ONLY     | se publicaría DTG-00040 (CATALOG_ITEM:crea1)                                                                                                                                                                             | —       |
| MIGF-O-010   | Invitación para evento                 | RESOLVED    | ALIAS → MIGF-O-008, MIGF-O-009             | NOT_APPLICABLE | no se publica                                                                                                                                                                                                            | —       |
| MIGF-O-011   | Invitación con sobre                   | RESOLVED    | CONFIGURATION → MIGF-O-008, MIGF-O-009     | NOT_APPLICABLE | no se publica                                                                                                                                                                                                            | —       |
| MIGF-O-012   | Invitación con sello                   | RESOLVED    | CONFIGURATION → MIGF-O-009                 | NOT_APPLICABLE | no se publica                                                                                                                                                                                                            | —       |
| MIGF-O-013   | Invitación con acrílico                | RESOLVED    | CONFIGURATION → MIGF-O-009                 | NOT_APPLICABLE | no se publica                                                                                                                                                                                                            | —       |
| MIGF-O-014   | Invitación especial                    | RESOLVED    | LEGACY_INVALID                             | NOT_APPLICABLE | no se publica                                                                                                                                                                                                            | —       |
| MIGF-O-015   | Imanes para vehículo — par de 2 × 1 ft | PUBLISHED   | —                                          | READY          | ya publicado DTG-00004 (CATALOG_ITEM:enlaza1 PRICE:enlaza1)                                                                                                                                                              | —       |
| OWN-MT-O-046 | Periódico personalizado para eventos   | PUBLISHABLE | ACTIVE · PIECE                             | QUOTE_ONLY     | se publicaría DTG-00041 (CATALOG_ITEM:crea1)                                                                                                                                                                             | —       |
| OWN-O-007    | Invitación formal                      | RESOLVED    | STYLE → MIGF-O-008, MIGF-O-009             | NOT_APPLICABLE | no se publica                                                                                                                                                                                                            | —       |
| OWN-O-008    | Invitación casual                      | RESOLVED    | STYLE → MIGF-O-008, MIGF-O-009             | NOT_APPLICABLE | no se publica                                                                                                                                                                                                            | —       |

Resumen: 21 en alcance · 13 pasan como producto (5 ya publicados) · **8 resueltos como no-producto** · 0 bloqueados. Antes de esta pasada: 5 publicados, 16 bloqueados.

## Qué haría el permiso ampliado

- Nuevo permiso (reemplaza al anterior, `supersedes_id`), mercado USA, referencias a D-001, D-002, D-003, D-010, D-016 y D-018; D-022 sigue eximida sólo para México.
- Incluye los candidatos **aprobados** de los 13 items que pasan; los alias/configuraciones/estilos/legacy ya están rechazados en staging con su disposición y **no** entran.
- 8 CatalogItems nuevos: DTG-00034 (MIG2-O-037), DTG-00035 (MIG2-O-038), DTG-00036 (MIG2-O-039), DTG-00037 (MIG2-O-047), DTG-00038 (MIG2-O-048), DTG-00039 (MIGF-O-008), DTG-00040 (MIGF-O-009), DTG-00041 (OWN-MT-O-046).
- Los 2 items **CANDIDATE** (Seating / Thank-you) se migran como registro interno con estado CANDIDATE: ningún perfil de publicación admite CANDIDATE (sólo ACTIVE), así que nunca son públicos.
- Ningún precio se crea: todos los nuevos quedan ACTIVE + QUOTE_ONLY (o CANDIDATE sin precio).
- Los 5 items ya publicados no cambian (cero enlaces nuevos, cero escrituras).

## Garantías del ensayo

- Todo el ensayo corre dentro de un savepoint con rollback y restaura el asignador de códigos públicos.
- Comprobación de no-escritura: `catalog_item`, `migration_*`, `import_candidate` y la secuencia de códigos son idénticos antes y después (**OK**).
- Compuerta, permiso por candidato, procedencia e idempotencia de STEP 09 intactos; la barrera global `PUBLICATION_ENABLED_FOR` no se toca.

```json
{
  "catalog_items": 17,
  "active_items": 13,
  "candidate_items": 3,
  "permits": 1,
  "permit_items": 24,
  "publications": 24,
  "published_scope_items": 5,
  "dispositions": 8,
  "rejected_candidates": 22,
  "published_candidates": 24,
  "authorized_prices": 14,
  "code_seq": 33
}
```
