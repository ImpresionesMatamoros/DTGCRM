# E2E del Admin (Playwright)

Flujos críticos de STEP 06 (escenarios A–F del prompt §41) contra la app real y la base local.

```bash
pnpm db:rebuild
export DTG_SOURCES=<ruta>/04_SOURCE_WORKBOOKS
pnpm importer:envelopes && pnpm import:dry-run --report /tmp/dry-run.md   # 413 candidatos reales en staging
pnpm test:e2e                                                             # next build + playwright test
```

- Usa el Chromium del entorno (`PLAYWRIGHT_BROWSERS_PATH`); no hace falta `playwright install` si ya existe.
- **Escribe en la base local**: guarda borradores, aprueba un candidato real, crea un item y hace un cambio masivo. Para volver al estado limpio: `pnpm db:rebuild` y recarga el staging.
- No corre en CI: necesita los Excel (P1-10) y un servidor.
