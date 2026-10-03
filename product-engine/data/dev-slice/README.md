# Dev slice data

Datos de **desarrollo** del vertical slice aprobado en STEP 03 (16 items). No son verdad productiva (ADR-0013).

- `authorized-prices.v1_2.json`: las 131 tarifas autorizadas por el dueño (2026-09-15) extraídas de
  `Design_To_Go_Catalog_v1.2_RC_MANGO_TANGO.xlsx` (SHA-256 `41b4fc07c5056299e13c8ce7108e3ae57ed7d6830b37828a0caf7f9b9fd17534`)
  por el extractor de STEP 03 (`STEP_03_OUTPUT/evidence/extract.py`). `lineage` conserva los `Precio_ID` originales.
- `index.ts`: dataset tipado (items, opciones, composición, reglas, presentaciones, procedencia).
  Los **estados** de los items son provisionales hasta confirmación del dueño (P1-01).

No editar el SQL generado: modificar este dataset y ejecutar `pnpm seed:generate`.
