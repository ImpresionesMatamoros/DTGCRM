# Revisión, aprobación y publicación

## Estados (`import_review_status`)

`PENDING → VALID | WARNING | BLOCKED → APPROVED → PUBLISHED`, y `REJECTED` desde cualquier estado no terminal. Vocabulario **disjunto** de `catalog_status` (una prueba lo verifica). Reglas en la base (`import_candidate_guard`):

| Desde               | Hacia                                                           |
| ------------------- | --------------------------------------------------------------- |
| PENDING             | VALID, WARNING, BLOCKED, REJECTED                               |
| VALID / WARNING     | entre sí, BLOCKED, APPROVED, REJECTED                           |
| BLOCKED             | VALID, WARNING (re-validación), REJECTED — **nunca APPROVED**   |
| APPROVED            | PUBLISHED (requiere enlace de dominio), REJECTED, VALID/WARNING |
| PUBLISHED, REJECTED | terminales                                                      |

## Aprobar (programático, uno por uno)

```ts
approveCandidate(db, candidateId, {
  reviewer: 'martin',
  resolution: { status: 'ACTIVE', decorationPolicy: 'NONE' },
});
rejectCandidate(db, candidateId, { reviewer: 'martin', reason: '…' });
```

La resolución se valida con Zod por tipo (`src/import/resolution.ts`) y debe cubrir **todos** los campos sin resolver. `approval_sha256 = sha256(hash del workbook + hash de la propuesta + tipo + resolución)`: una aprobación no se puede reutilizar en otra corrida ni editar (sólo se re-aprueba pasando por el flujo).

| Kind           | Resolución                                                                                                                                    |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `CATALOG_ITEM` | `status`\*, `decorationPolicy`, `itemType`\*, `customerSuppliedItem` (siempre en SERVICE), `canonicalName`, `saleUnit`, `target`              |
| `OPTION`       | `definition` (EXISTING key / CREATE), `isRequired`\*, `selectionMode`, `isDistributable`, `values` por registro (EXISTING / CREATE / EXCLUDE) |
| `DECORATION`   | `methodKey` (asociación) / `decorationPolicy` (política)                                                                                      |
| `COMPOSITION`  | `childLegacyId`, `role`, `quantity` (cuando la fuente no los da)                                                                              |
| `PRICE`        | `validFrom` (siempre), `maxQuantity` (FIXED sin cantidad), `amountBasis`\*, `target`                                                          |
| `PRESENTATION` | `locale`\*, `isDefault`, `displayName`, `target`                                                                                              |

\* sólo si la fuente no lo trae. `target`: `CREATE` o `LINK_EXISTING` (entidad existente; obligatorio si el linaje ya existe).

## Publicar

```ts
publishCandidate(db, candidateId, { publisher: 'martin' });   // un candidato APPROVED
previewCandidate(db, candidateId, resolution?);               // adaptador en seco, sin escribir
```

1. Verifica `APPROVED` y el hash de aprobación.
2. Construye `AdapterContext` desde la base y ejecuta el adaptador (puro).
3. Si hay errores: nada se escribe; se registran como `import_issue` de origen `ADAPTER`.
4. Ejecuta el plan en un savepoint: filas de dominio, `source_reference`, `import_candidate_link`; marca `PUBLISHED`.

El adaptador rechaza: candidato bloqueado, campos sin resolver, tipo sin resolver, dependencias no publicadas (item, opción de una condición), linaje ambiguo, duplicado de linaje (`LINEAGE_EXISTS`), valores de opción sin decisión o inválidos, opción de item en conflicto, capacidad sobre item `NONE`, ciclos de composición, moneda distinta a la del price book, importes con más de 2 decimales, definición de precio ya existente (`PRICE_DEFINITION_EXISTS`) o distinta al enlazar (`PRICE_MISMATCH_WITH_EXISTING`), segunda presentación default, presentación con el mismo nombre sin `target` explícito (`PRESENTATION_EXISTS`: un nombre nunca es identidad), evidencia de material del cliente en un PRODUCT.

**Precios:** siempre `DRAFT`. "Autorizado en la fuente" ≠ autorizado en Product Engine; la autorización (`AUTHORIZED` con autorizador) es un acto aparte (P1-06). Un `DRAFT` no llega al snapshot de pricing.

**Orden natural:** CATALOG_ITEM → DECORATION (política) → OPTION → PRICE / DECORATION (método) / COMPOSITION / PRESENTATION.

## Política de STEP 05B

`PUBLICATION_ENABLED_FOR = ['FIXTURE']`: sólo lotes DEV/TEST controlados pueden escribir en el dominio. Los lotes `REAL` (los ~220 items) se validan, se revisan y se previsualizan, pero `publishCandidate` responde `NOT_PUBLISHABLE_IN_THIS_STEP`. Habilitarlo es decisión del dueño en una etapa posterior.
