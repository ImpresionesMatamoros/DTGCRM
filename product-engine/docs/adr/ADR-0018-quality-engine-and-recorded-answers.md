# ADR-0018 — Motor de calidad puro, respuestas de decisión registradas, mapeos y marcas

**Estado:** ACEPTADO (STEP 08)

## Contexto

STEP 07 dejó 22 decisiones del dueño abiertas y 413 candidatos reales en staging, casi todos con campos sin resolver. Hacía falta responder "¿qué tan listo está el catálogo?" y actuar sobre los problemas sin adivinar ni ocultar nada.

## Decisión

1. **Motor puro** (`src/quality`): sin BD, reloj ni React. Reglas deterministas con código estable `DQ-<ÁREA>-NNN`, versión, severidad (BLOCKER/WARNING/INFO), entidad, evidencia y tipo de remediación (`BULK_RESOLVABLE`, `MANUAL_REVIEW`, `OWNER_DECISION_REQUIRED`, `SOURCE_FIX`). El `asOf` es explícito.
2. **Los hallazgos no se guardan**: se recalculan al pedirlos (unos miles de candidatos es barato). Clave estable `regla:linaje:sujeto`, comparable entre corridas. Sin snapshots, sin trabajos en segundo plano.
3. **Preparación en dimensiones separadas** (revisión, dominio, precios, publicación) con razones; no hay puntaje 0–100. Una decisión abierta cuyo alcance incluye al artículo vuelve el hallazgo `OWNER_DECISION_REQUIRED`; al registrarse una respuesta, vuelve a la remediación propia de la regla. Nada se rellena con valores por defecto.
4. **Respuestas de decisión** en `owner_decision_answer` (append-only, cadena `supersedes_id`): decisión, respuesta, actor, fecha, notas, asignaciones opcionales. Capability `decision.record` (rol controlado `local_decision_recorder`/`local_owner`, `DTG_DECISION_RECORDERS`). La app nunca responde sola. Se reutiliza el planificador masivo de STEP 06; `DECISION_GROUP` exige una respuesta vigente y guarda `decision_answer_id`. No se reutilizó `decision_record` de STEP 04 (modelo de dominio distinto, con sujetos); esto es sólo la evidencia mínima auditable.
5. **Mapeo de categorías** (`category_mapping`) y **marcas de duplicados** (`quality_mark`, sólo DISTINCT/REVIEWED, sin fusión): tablas append-only con auditoría.
6. **Masivos estrictos**: modo `strict` rechaza selecciones incompatibles con el campo (INCOMPATIBLE_SELECTION); la vista previa añade NOT_APPLICABLE/BLOCKED y un resumen; nada se sobrescribe sin confirmación; las vistas previas obsoletas se rechazan.
7. La publicación REAL sigue deshabilitada; los precios históricos son evidencia y sólo generan hallazgos si intentan alimentar precios vigentes.

## Consecuencias

Tres tablas nuevas (migración 0016), ninguna para hallazgos. Cambio de comportamiento deliberado: aplicar un grupo de decisión sin respuesta registrada ahora falla (`DECISION_NOT_ANSWERED`). Las reglas DQ-CATALOG-003 y DQ-PRICE-003 miran ambas la unidad de venta (la primera desde el catálogo, la segunda desde el precio); el solapamiento está documentado en `docs/step08/DATA_QUALITY_RULES.md`.
