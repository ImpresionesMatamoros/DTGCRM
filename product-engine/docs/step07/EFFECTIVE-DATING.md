# Vigencia efectiva

Intervalo semiabierto `[valid_from, valid_to)`, resolución pura con `asOf` explícito (ADR-0009). El resolver considera vivas las filas AUTHORIZED **y SUPERSEDED** dentro de su intervalo, de modo que una cotización con `asOf` pasado se reproduce igual (ADR-0017).

Conflictos analizados antes de autorizar (`src/pricing/conflicts.ts`): `IDENTICAL_SCOPE`, `SPECIFICITY_TIE` (bloquean), `DEFINITION_INVALID`, `RETROACTIVE_SUPERSESSION`, `PREDECESSOR_WINDOW` (bloquean), `PRECEDENCE` (informativo). El borrador se simula en memoria con `overlayDraft`. Parámetro FX (`usd_mxn_fx`): sólo revisiones futuras, anexadas tras la última.
