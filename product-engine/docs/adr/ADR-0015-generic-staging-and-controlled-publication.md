# ADR-0015 — Staging genérico, revisión separada y publicación controlada

**Estado:** ACEPTADO (STEP 05B)

## Decisión

1. **Staging genérico.** Seis tablas `import_*` (lote, registro, candidato, fuente, issue, enlace). El candidato tiene `kind` (`CATALOG_ITEM`, `PRICE`, `OPTION`, `DECORATION`, `COMPOSITION`, `PRESENTATION`) y una propuesta JSONB. No se crean tablas `staging_<concepto>`: el tipo + la propuesta tipada con Zod bastan, y el dominio ya define las formas finales.
2. **Staging ≠ dominio.** El JSONB nunca entra directo a tablas de dominio: pasa por el Domain Adapter puro (`src/import/adapter.ts`) tras aprobación humana. Pricing y CRM no leen staging.
3. **Revisión separada del ciclo de vida.** `import_review_status` (`PENDING, VALID, WARNING, BLOCKED, APPROVED, REJECTED, PUBLISHED`) es disjunto de `catalog_status`. Un estado comercial desconocido queda `null` en la propuesta y como campo sin resolver; nunca se convierte en `CANDIDATE` ni en un quinto estado.
4. **Nada por defecto.** `null` = desconocido. `Obligatoria` vacía no es `false`, la clase vacía no es `PRODUCT`, la vigencia de un precio no es "ahora", la cantidad de un precio FIXED no es 1. Cada hueco exige resolución explícita en la aprobación.
5. **Aprobación ligada.** La aprobación guarda la resolución validada y `approval_sha256` (workbook + propuesta + resolución). Un workbook nuevo produce candidatos nuevos que requieren aprobación nueva.
6. **Publicación controlada.** Un candidato a la vez; sin aprobación ni publicación masiva. Precios siempre `DRAFT` (la autorización en PE es otro acto, P1-06). En STEP 05B sólo lotes `FIXTURE` pueden escribir en el dominio (`PUBLICATION_ENABLED_FOR`).
7. **Procedencia en dos capas.** Las celdas 05A viven en staging; el dominio recibe `source_reference` (`LEGACY_ID`, `EXCEL_ROW`, `HISTORICAL_PRICE_EVIDENCE`) y `import_candidate_link` une ambas en los dos sentidos. `LEGACY_ID` es el índice de linaje que impide duplicar entidades al reimportar.
8. **Historia inmutable.** Staging es append-only; el historial de revisión usa `change_event` con scope `IMPORT` (no mueve las revisiones de catálogo/pricing).

## Consecuencias

- El Admin MVP (STEP 06) sólo necesita UI sobre `approveCandidate` / `rejectCandidate` / `previewCandidate` / `publishCandidate`.
- Habilitar la publicación de datos `REAL` es una decisión explícita del dueño (una línea de código + pruebas), no un efecto colateral.
