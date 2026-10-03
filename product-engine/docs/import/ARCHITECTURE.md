# Pipeline de importación — arquitectura (STEP 05B)

```
Excel (sólo lectura, SHA-256 antes/después)
  → tools/excel-importer/parser        STEP 05A v0.1.0, sin cambios (Python/openpyxl)
  → tools/excel-importer/interchange   ImportEnvelope v1 (JSON neutral, versionado)
  → src/import/contract.ts             Zod (+ JSON Schema generado)
  → src/import/staging-plan.ts         plan puro: registros, candidatos, issues
  → src/db/import/staging.ts           staging persistente (import_*) + validación
  → revisión humana                    src/db/import/review.ts (aprobar / rechazar, uno por uno)
  → src/import/adapter.ts              Domain Adapter puro → plan de escritura validado
  → src/db/import/publish.ts           publicación controlada (sólo FIXTURE en 05B)
  → dominio STEP 04                    catalog_item, item_option, price_definition (DRAFT), …
```

**Se detiene antes de la publicación productiva automática**: no hay aprobación ni publicación masiva, y los lotes `REAL` no pueden escribir en el dominio en esta etapa.

## Capas y fronteras

| Capa                 | Código                                                             | Regla                                                                                  |
| -------------------- | ------------------------------------------------------------------ | -------------------------------------------------------------------------------------- |
| Parser               | `tools/excel-importer/parser`                                      | Hipótesis trazables; sin UUID, código público ni publicación                           |
| Interchange          | `tools/excel-importer/interchange`                                 | Serializa sin perder celdas; agrega evidencia de presentaciones; sin reglas de negocio |
| Contrato             | `src/import/contract.ts`                                           | Valida forma y referencias cruzadas; rechaza envelopes inválidos con errores tipados   |
| Plan de staging      | `src/import/{staging-plan,proposal,mappings,requirements,keys}.ts` | Puro y determinista (ESLint: sin `pg`, Next ni reloj)                                  |
| Adaptador de dominio | `src/import/{adapter,resolution}.ts`                               | Puro; todo hecho del dominio llega por `AdapterContext`                                |
| Persistencia         | `src/db/import/*`                                                  | Transacción del llamador; staging nunca escribe tablas de dominio                      |
| CLI                  | `scripts/import.ts`                                                | Sólo base local                                                                        |

Staging y dominio no comparten tablas: el JSONB de `import_candidate.proposal` sólo llega al dominio a través del adaptador, después de una aprobación explícita. Pricing y CRM nunca leen `import_*`.

## Qué agrega 05B a 05A

- Contrato de intercambio versionado y validado en runtime.
- Persistencia de cada corrida (`import_batch`), registros, candidatos, fuentes e issues.
- Candidatos `PRESENTATION` (desde `PRESENTACIONES` / `PRESENTACIÓN_OFERTA`).
- Agrupación de 131 observaciones de precio en 14 hipótesis de `PriceDefinition`.
- Estado de revisión, aprobación ligada a la propuesta, adaptador y publicación controlada.
- Linaje staging → dominio y procedencia en ambos sentidos.

## Qué no hace (fuera de alcance)

Supabase remoto, despliegue, CRM, Admin UI, editor masivo, rediseño del motor de precios, Variant, Bundle, Supplier, Brand, inventario, BOM, work orders, auto-aprobación y publicación masiva.

Ver: [INTERCHANGE-CONTRACT](INTERCHANGE-CONTRACT.md) · [STAGING](STAGING.md) · [REVIEW-WORKFLOW](REVIEW-WORKFLOW.md) · [PROVENANCE](PROVENANCE.md) · [REIMPORTS](REIMPORTS.md) · [dry run](IMPORT-DRY-RUN-REPORT.md).
