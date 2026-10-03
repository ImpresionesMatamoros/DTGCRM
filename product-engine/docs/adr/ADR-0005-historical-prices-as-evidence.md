> Importado de STEP 03 (`STEP_03_OUTPUT/ADR/ADR-005-historical-prices-as-evidence.md`). Estado para implementación: **ACEPTADO** en STEP 04. Numeración STEP 03: ADR-005.

# ADR-0005 — Precios históricos no autorizados se guardan como evidencia, no como PriceDefinition

**Estado:** PROPUESTO · **Afecta:** migración de 23 tarifas `NO AUTORIZADO` (STEP 01 INVENTORY §5.4), BR-025

## Problema

Si los precios históricos (lona 3 USD/ft², camiseta 15 USD, etc.) entran a `PriceDefinition` con un estado “HISTORICAL”, basta un filtro olvidado en una consulta, un export o un reporte para que se usen como vigentes. BR-025 debe ser una garantía estructural, no una convención.

## Decisión

- Tarifas históricas y supersedidas se guardan como `SourceReference` de tipo `HISTORICAL_PRICE_EVIDENCE` con payload estructurado (importe, moneda, unidad, condiciones literales, fila fuente, motivo de no autorización).
- `PriceDefinition` sólo admite estados `DRAFT` · `AUTHORIZED` · `SUPERSEDED`; el resolvedor sólo lee `AUTHORIZED` dentro de vigencia.
- `SUPERSEDED` es para versiones anteriores de un precio **que sí fue vigente dentro de Product Engine**; no para evidencia importada.

## Verificación

Ningún caso T01–T12 depende de precios históricos para resolver. T03/T04/T05/T06 devuelven `QUOTE_ONLY` como exige BR-024/025.
