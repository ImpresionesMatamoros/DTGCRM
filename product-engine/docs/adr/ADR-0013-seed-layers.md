# ADR-0013 — Capas de datos: referencia, dev slice y fixtures de prueba

**Estado:** ACEPTADO (STEP 04)

## Decisión

| Capa          | Archivo                                                                   | Contenido                                                                                                                          | ¿Verdad productiva?                                                               |
| ------------- | ------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| REFERENCE     | `supabase/seeds/0001_reference.generated.sql` (desde `data/reference.ts`) | Mercados, price books, FX provisional, métodos de decoración confirmados, perfiles de publicación                                  | Sí, salvo valores marcados provisionales (FX 16.50, factor 0.70)                  |
| DEV SLICE     | `supabase/seeds/0002_dev_slice.generated.sql` (desde `data/dev-slice/`)   | 16 items del vertical slice de STEP 03 con precios **autorizados reales** y estados **provisionales**                              | **No.** Datos de desarrollo; los estados requieren confirmación del dueño (P1-01) |
| TEST FIXTURES | `tests/fixtures/**`                                                       | Datos sintéticos (`FIXTURE`) para casos sin evidencia real (México manual, factor por item, base de camiseta, reglas en conflicto) | **Nunca.** Sólo en memoria o dentro de transacciones revertidas                   |

- Ambos SQL se **generan** desde datasets tipados (`data/`) con `pnpm seed:generate`; CI verifica que el SQL comprometido coincide (`pnpm seed:check`).
- Los mismos datasets construyen el snapshot en memoria de las pruebas unitarias, por lo que base de datos y pruebas comparten identidades (UUID v5 deterministas) y se verifica que ambos snapshots son iguales.
- Las pruebas fallan si los datasets o las tarifas sembradas contienen la palabra `FIXTURE`.
