# ADR-0017 — Linaje de revisiones y reproducción temporal de SUPERSEDED

**Estado:** ACEPTADO (STEP 07)

## Contexto

Los precios autorizados son inmutables, pero deben cambiar con el tiempo sin perder la capacidad de cotizar “como era” (ADR-0009).

## Decisión

1. Revisiones con `lineage_id`/`version`/`supersedes_id`/`superseded_by_id`; una sola sucesora por predecesor.
2. Al sustituir, el predecesor cierra `valid_to` (única mutación permitida, sólo NULL→valor) y pasa a SUPERSEDED conservando su intervalo.
3. El resolver trata AUTHORIZED y SUPERSEDED como vivas dentro de su intervalo; así un `asOf` pasado reproduce el precio de entonces.
4. Sin supersesión retroactiva; el predecesor debe iniciar antes que la revisión y su `valid_to` debe coincidir con el `valid_from` de la nueva.
5. Capability separada `price.authorize` (rol local `local_price_authorizer`); D-016 sigue abierta.
6. Auditoría con `change_event.reason`.

## Consecuencias

Corregir un error en un precio vigente exige una revisión futura; no hay edición in situ. Un choque de concurrencia se evita con lock asesor + trigger diferido (probado con carrera real).
