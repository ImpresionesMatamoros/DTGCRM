# STEP 09 — MVP Verification (gates A–H)

## Actualización — verificación de las puertas A–H tras la pasada Owner Decisions

Las puertas se re-verificaron en la reconstrucción limpia de la pasada de cierre (`OWNER_DECISIONS_COMPLETION_REPORT.md`):

| Puerta                      | Estado tras la pasada | Evidencia                                                                                                                  |
| --------------------------- | --------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| A. Categoría real           | PASS, con masa mayor  | 13 productos de Commercial Print en Product Engine (11 ACTIVE + 2 CANDIDATE internos); 21/21 filas resueltas, 0 bloqueadas |
| B. Administración sin Excel | PASS                  | e2e de migración 9 + 19 + 8 de la pasada (la página de migración muestra productos, resueltos y bloqueados)                |
| C. Precios                  | PASS                  | 120.00 / 400.00 / 65.00 por el Price Engine, sin cambios                                                                   |
| D. Seguridad quote-only     | PASS                  | 750, 2 pares y todos los items nuevos cotizan; ningún precio inventado                                                     |
| E. Procedencia              | PASS                  | 34/34 candidatos publicados trazables hasta hoja y celda; la evidencia de las filas no-producto se conserva                |
| F. Reproducibilidad         | PASS                  | reconstrucción limpia: schema 0001–0018 → importación → STEP 09 → pasada de cierre → todas las suites                      |
| G. Seguridad de publicación | PASS                  | barrera global cerrada; 0 fuera de alcance, 0 fuera del permiso                                                            |
| H. Seguridad de alcance     | PASS                  | otras categorías sin publicar                                                                                              |

Los P1 que calificaban la clasificación original (D-001 / D-002 / D-003 sobre 16 filas) quedaron **cerrados**. La clasificación original (abajo) se conserva como historial; la clasificación de la pasada de cierre está en `OWNER_DECISIONS_COMPLETION_REPORT.md`.

---

## Pasada original de STEP 09 (historial, sin cambios)

Evidence: `data/post-migration.json`, `data/test-results.json`, `data/workbooks.sha256`, `PUBLISHED` items in `data/published-items.md`. Everything below comes from the clean rebuild (`tools/step09-rebuild.sh`).

## Useful-mass criterion (defined before judging)

Commercial Print is "operationally useful" when ALL hold:

1. At least 3 distinct item families live as REAL, ACTIVE, publicly coded items.
2. At least one family priced by quantity matrix with options (real authorized prices).
3. At least one fixed-price item, and at least one ACTIVE item that is correctly QUOTE_ONLY.
4. Every published item traces to workbook sheet/cell; the owner's known price cases resolve exactly.
5. The category can be maintained from Admin (create, edit, price revision, history) without Excel.

Not required: 21/21, nor a price for every item (OD-01..OD-05).

Result against the criterion: 5 of 21 scoped items are published — Business Cards (Traditional, Premium), Flyers, Vehicle Magnets (pair), Postales. This covers three families (cards, flyers, magnets) plus an ACTIVE+QUOTE_ONLY item. Criteria 1–5 are met. **The mass is minimal-but-defensible, not complete: 16 items stay blocked by unanswered owner decisions.**

## Gates

| Gate                            | Verdict             | Evidence                                                                                                                                                                                                                             |
| ------------------------------- | ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| A. Real category                | PASS (partial mass) | 5 REAL items, codes DTG-00001..04 and DTG-00029, status ACTIVE, 14 AUTHORIZED price definitions (cards 2+2, flyers 9, magnet 1). 16/21 not migrated (see below).                                                                     |
| B. Administration without Excel | PASS                | Playwright `00-migration.spec.ts` (9 flows) + `admin.spec.ts`: create a DEV item, find, edit, history; migration page: dry run, permit approval, publication, revoke. Source workbooks are not read at runtime.                      |
| C. Pricing                      | PASS                | Through the real Price Engine: Premium card 2 caras ×500 = 120.00; Flyer media carta 2 caras ×1000 = 400.00; Imanes 1 par = 65.00. Price Engine code unchanged.                                                                      |
| D. Quote-only safety            | PASS                | Qty 750 → QUOTE_ONLY (QUANTITY_NOT_IN_MATRIX, no interpolation); 2 pares → QUOTE_ONLY (FIXED_PRICE_QUANTITY_NOT_AUTHORIZED, no 2×65); Postales → QUOTE_ONLY (NO_AUTHORIZED_BASE_PRICE).                                              |
| E. Provenance                   | PASS                | 24/24 published candidates have a full chain to workbook sheet/cell; 0 broken; 5/5 items traced (26–72 cells each).                                                                                                                  |
| F. Reproducibility              | PASS                | Clean clone: schema 0001–0017 → import → decisions → dry run → permit → publish → reports; 237 unit / 128 db / 39 importer / 9+19 e2e green; second publication run creates nothing (24 publications, 0 duplicate links/legacy ids). |
| G. Publication safety           | PASS                | `PUBLICATION_ENABLED_FOR` unchanged (`['FIXTURE']`); REAL only via permit-bound path; 0 published outside permit; 0 out of scope; every item re-evaluated by the item-aware gate at write time.                                      |
| H. Scope safety                 | PASS                | Permit scope = 21 legacy ids only; 0 REAL candidates outside it; Apparel/Displays/others untouched.                                                                                                                                  |

All structural gates pass. The reason the result is not an unconditional PASS is gate A's mass: it depends on owner decisions that this step may not infer.

## What blocks the other 16 (not fabricated)

- D-001 (ACTIVE/INACTIVE) — answered only for the 5 confirmed items; absence ≠ inactive, so the rest cannot be defaulted.
- D-002 (sale unit) — answered for Postales and magnets only.
- D-003 (product vs service for ambiguous items) — open.
- D-004, D-005, D-009, D-018 — class C (do not block MVP) but remain open.
- D-022 — waived for MX only because the permit is USA-scoped (OD-09).

## Classification

**PASS WITH P1 OPEN ITEMS.** Structural gates A–H pass; the useful-mass criterion is met at its minimum; the 16 blocked items need D-001/D-002/D-003 answers (per-item list in `OWNER_DECISION_GATE.md`).
