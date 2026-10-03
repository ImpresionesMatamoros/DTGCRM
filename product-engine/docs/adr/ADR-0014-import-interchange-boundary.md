# ADR-0014 — Frontera de importación: parser Python + contrato JSON versionado

**Estado:** ACEPTADO (STEP 05B)

## Contexto

STEP 05A entregó un parser Python/openpyxl determinista, con procedencia por celda, 27 pruebas y fixtures reales. Product Engine es TypeScript/PostgreSQL. Reescribir el parser duplicaría reglas y perdería la verificación ya hecha.

## Decisión

- El parser 05A se conserva **sin cambios** (v0.1.0) en `tools/excel-importer/parser`. Sólo se cambiará por una razón funcional concreta y subiendo su versión.
- La frontera es un JSON neutral y versionado, `ImportEnvelope` v1 (`dtg.import-envelope`), emitido por `tools/excel-importer/interchange` y validado en TypeScript con Zod (`src/import/contract.ts`). El JSON Schema se genera desde Zod y se verifica en CI.
- El envelope no contiene objetos de base de datos, UUID de Product Engine, códigos públicos ni banderas de publicación. Conserva valores RAW/normalizados y todas las celdas; los candidatos referencian registros sin duplicar celdas, y el exportador demuestra que no se pierde ninguna.
- Las presentaciones (evidencia RAW en 05A) se agregan en el interchange, no en `mapper.py`.
- Los Excel no se versionan en Git: `DTG_SOURCES` apunta a ellos. Se versionan fixtures `FIXTURE` (subconjuntos reales) y un extracto sin celdas de los precios.

## Consecuencias

- Dos lenguajes en el repo (Python sólo como herramienta de importación; CI instala Python 3.11 + openpyxl).
- Las pruebas con los workbooks reales se ejecutan localmente con `DTG_SOURCES`; CI ejecuta la parte independiente de las fuentes.
- Cambios incompatibles del contrato requieren `contract_version` 2.x y un bridge nuevo.
