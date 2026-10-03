# Autorización de precios

- Capabilities: `price.edit` (borradores), `price.authorize`, `market.policy`, `pricing.parameter`.
- `price.authorize` la tiene sólo el rol `local_price_authorizer`; los actores se listan en la variable `DTG_PRICE_AUTHORIZERS` (coma). Es un mecanismo local de desarrollo. **D-016 (quién autoriza precios en producción) sigue ABIERTA**; no se resolvió por inferencia.
- El handler `authorizePriceHandler` exige la capability en servidor; la UI sólo oculta el botón (con nota `authorize-capability-note`).
- Autorizar corre bajo lock asesor por (item, libro, componente), con savepoint: si el análisis de conflictos bloquea o el trigger diferido detecta choque, nada se escribe.
- Auditoría: `change_event` con `dtg.actor`, `dtg.context` y `dtg.reason` (nueva columna `reason`, migración 0015).
- Los precios importados REAL **nunca** se autorizan automáticamente.
