# STEP 09 — Commercial Print MVP Migration · Final Report

## Actualización — pasada Owner Decisions

Este informe describe la pasada original (5 de 21 migrados). La pasada de cierre aplicó la `OWNER_DECISION_SPEC_v1.0`: **13 productos + 8 filas no-producto + 0 bloqueadas**, migración 0018, 36 pruebas Playwright (9 + 19 + 8), 258 unit y 133 DB, reconstrucción limpia y workbooks sin cambios. Los P1 listados abajo (D-001/D-002/D-003 para 16 filas) están cerrados; los P2 vigentes, la lista de filas y la clasificación de esa pasada están en `OWNER_DECISIONS_COMPLETION_REPORT.md`. Lo que sigue es el informe original, sin cambios.

---

## Pasada original de STEP 09 (historial, sin cambios)

## Final report (19 items)

1. **Initial HEAD:** `8956965` (STEP 08 baseline, `dtg-product-engine-step08.zip`).
2. **Final HEAD:** see the delivered zip (`git rev-parse HEAD`); last code commit `4ba5073`, followed by the docs commits.
3. **Branch:** `step09/commercial-print-mvp`.
4. **Commits:** `eca6595` assessment · `55641b0` decision answers scoped to the items they cover · `f71db6a` permit, item-aware gate, permit-bound publication · `9f80c39` tests + scripts · `77564e8` admin migration page/actions/capabilities · `44810ac` e2e + post-migration reports · `7c8cefe` clean rebuild script · `433899e`, `4ba5073` test/ADR/docs fixes · docs commits (reports, MVP verification, this report).
5. **Migrations added:** `0017_migration_permit.sql` only. 0001–0016 are byte-identical to `8956965`.
6. **Tables/constraints:** `migration_permit`, `migration_permit_item`, `migration_publication` (append-only, audit triggers, `unique(candidate_id)`, deferred guard trigger `migration_publication_guard`). Code: role `local_migration_owner`, capabilities `migration.approve|publish`.
7. **Exact scope:** 21 legacy ids of Commercial Print (permit `commercial-print-mvp`, market USA). No other category.
8. **Publishable vs blocked:** 21 scoped → 5 publishable, 16 blocked (open D-001/D-002/D-003; D-004/005/009/018 class C; D-022 waived for USA only).
9. **Actually published:** 5 items (24 candidates incl. variants/prices), 24 `migration_publication` rows. 6 "Impresión" DECORATION candidates were rejected per OD-04.
10. **Public codes:** DTG-00001 Tradicional, DTG-00002 Premium/Gloss, DTG-00003 Flyers, DTG-00004 Imanes (all linked to the existing dev-slice items), DTG-00029 Postales (new; gap from non-transactional sequence use in tests, allowed by ADR-0011).
11. **Pricing state:** 14 AUTHORIZED price definitions (cards 2+2, flyers 9, magnet 1); Postales ACTIVE + QUOTE_ONLY. Regression via the real Price Engine: 120.00 / 400.00 / 65.00; 750 and 2 pares and Postales QUOTE_ONLY. Price Engine unchanged; no future-dated authorized prices.
12. **Owner decisions used:** OD-01..OD-09. Recorded as answers: D-001 (5 items ACTIVE), D-002 (PIECE Postales), D-010 (PAIR magnets), D-016 (global; first REAL publication authorized by Martín). Master price authorization (OD-05) = the existing AUTHORIZED prices, verified equal to source.
13. **Open decisions:** **P1:** D-001 (remaining 16 items), D-002, D-003 — block 16 items. **P2:** D-004, D-005, D-009, D-018; D-022 (MX, waived); confirm interpretations below; HALF_UP_2 provisional (OD-09).
14. **Provenance:** 24/24 candidates traced to workbook sheet/cell, 0 broken (`data/post-migration.json`).
15. **Data Quality before → after:** findings 1281 → 1212; blockers 1053 → 989; owner-decision-required 691 → 678; candidates in staging 413 → 407.
16. **Tests:** unit 237 · db 128 · importer 39 · Playwright 9 (migration) + 19 (other) — all green; `tsc` and prettier clean.
17. **Clean rebuild:** fresh clone → schema 0001–0017 → import → decisions → dry run → permit → publish → reports → all suites green; second run idempotent (0 duplicate links/legacy ids/publications).
18. **Source workbooks:** 5 workbooks, SHA-256 unchanged (`data/workbooks.sha256`).
19. **Readiness for STEP 10 (CRM):** Ready to start for the 5 published items (stable public codes, ACTIVE, QUOTE_ONLY-safe pricing). CRM must treat the other 16 as unavailable until D-001/D-002/D-003 are answered; no CRM work was started here.

## Flagged interpretations (P2, please confirm)

- Postales = PIECE (not one of the three OD-02 lot exceptions).
- Category assigned per item from STEP 05C evidence + dev slice (impresos_papel ×4, servicios_especiales for magnets); source category labels not overwritten.
- Tarjetas/Flyers keep the domain's PIECE sale unit.
- The 6 "Impresión" decorations were rejected as internal technique (OD-04).
- Decisions/approvals were recorded by the session on Martín's behalf (actors `martin`, `step09-preparer`) with his chat message as evidence; he should review them in Admin → Migración.

## Requirement | Status | Evidence

| Requirement                                     | Status      | Evidence                                                      |
| ----------------------------------------------- | ----------- | ------------------------------------------------------------- |
| Assessment before changes                       | DONE        | `STEP_09_MIGRATION_ASSESSMENT.md`                             |
| Owner decision gate, no re-asking               | DONE        | `OWNER_DECISION_GATE.md`                                      |
| Minimal scoped migration permit, no global REAL | DONE        | migration 0017, ADR-0019, `PUBLICATION_ENABLED_FOR` unchanged |
| Item-aware gate                                 | DONE        | `src/migration/gate.ts`, `migration-gate.test.ts`             |
| Dry run before REAL write                       | DONE        | `REAL_PUBLICATION_DRY_RUN.md`                                 |
| Publish what legitimately passes                | DONE (5/21) | `COMMERCIAL_PRINT_MIGRATION_REPORT.md`                        |
| Don't invent prices/decisions                   | DONE        | 16 blocked with reasons; Postales QUOTE_ONLY                  |
| Price Engine unchanged; known regressions       | DONE        | pricing cases all OK                                          |
| Provenance chain                                | DONE        | 24/24                                                         |
| Idempotency, public codes                       | DONE        | 0 duplicates on rerun                                         |
| Admin without Excel                             | DONE        | e2e 00-migration + admin                                      |
| Post-migration Data Quality                     | DONE        | `POST_MIGRATION_DATA_QUALITY.md`                              |
| Other categories not migrated                   | DONE        | 0 out of scope                                                |
| Migrations 0001–0016 untouched                  | DONE        | git diff vs `8956965`                                         |
| Workbooks unchanged                             | DONE        | sha256                                                        |
| MVP gates A–H, useful mass                      | DONE        | `MVP_VERIFICATION.md`                                         |
| Full mass 21/21                                 | NOT MET     | 16 blocked by D-001/D-002/D-003 (P1)                          |

## Auto-audit (§46)

No global REAL · no out-of-scope publication · no inferred decisions (all answers explicit, scoped per item) · no silent null defaults (blocked instead) · no UI price hardcoding (migration page shows engine/DB values) · no historical prices active · no interpolation (750 → QUOTE_ONLY) · no duplicates on rerun · provenance intact · category labels mapped not overwritten · no destructive updates (append-only, existing items linked) · migrations 0001–0016 untouched · workbooks unchanged. No issues found.

## Classification

Structural gates pass; only 5/21 items are migrated because 16 depend on unanswered owner decisions.
