# STEP 05B integration plan

No comenzar STEP 05B hasta recibir el baseline M1 de contratos/dominio de STEP 04 o su entrega completa. No existe un repositorio STEP 04 suministrado en este paquete; ninguno fue creado ni modificado.

## Artefactos exactos requeridos

1. Versión/commit identificable de contratos TypeScript y validadores del dominio: CatalogItem, CatalogStatus nullable de migración, unidades, opciones y valores, DecorationMethod/Capability, CompositionLine, PriceDefinition/Break/Condition, SourceReference y DecisionRecord.
2. Decisiones definitivas de los ADR y resolución del conflicto de enums Q-01. Semántica de nulos y campos requeridos, incluida Obligatoria.
3. Interfaces de persistencia/repositories o puertos de aplicación, forma de transacciones y límites de staging. Esquema/migraciones sólo como referencia del trabajo que ya pertenece a STEP 04.
4. Contrato de identidad: UUID, public_code, lookup de LEGACY_ID, mappings de fusiones, cardinalidad permitida de linajes y estrategia idempotente entre versiones.
5. Contratos de autorización y aprobación de lotes, roles, registro de actor/fecha/revisión, control de concurrencia y auditoría.
6. Representación final de FIXED vs matrices, amount_basis, moneda/mercado, vigencia/autoría y separación de HISTORICAL_PRICE_EVIDENCE. Contrato de revisión de hipótesis, nunca activar por default.
7. Entorno local de pruebas, fixtures permitidos, comando CI, validadores y puertos de test para comprobar integración sin producción.

## Bridge propuesto

`STEP 05A raw/candidates → adaptador contra contratos STEP 04 → validación de dominio → persistencia de staging`

Primero congelar una versión de estos resultados y ejecutar pruebas de compatibilidad. Resolver vocabularios aprobados con tablas de mapping versionadas, adjuntando decisión y fuente. Convertir sólo hipótesis aceptadas a tipos STEP 04; sin match, producir DOMAIN_MAPPING_QUESTION. Resolver referencias mediante un índice de linaje explícito, nunca asignar UUID usando un SKU antiguo.

Agrupar 130 puntos en 13 matrices exactas; adaptar el precio fijo de imanes según contrato. Conservar todos los puntos, condiciones y procedencias. Los históricos viajan por una interfaz exclusiva de evidencia. Validar que las 131 observaciones se reconcilian sin duplicar ni perder ninguna. No sintetizar cantidades, tipos de papel ni tasas de México.

Persistir primero un lote de staging transaccional con hash, parser version, reportes e issues. Ninguna transacción escribe directamente productos activos. Diseñar la publicación separada con revisión humana y aprobación explícita sobre hash/revisión; impedir que una fuente cambiada reutilice una aprobación anterior.

## Pruebas de aceptación del bridge futuro

- RAW conserva mismos hashes y valores; autoridad primaria inalterada.
- Dos importaciones idénticas no duplican staging y dos versiones se concilian por linaje, no por coordenada.
- No existe candidato publicable TEST ni precio histórico resoluble.
- Nulos siguen siendo nulos; ninguna nueva variante cartesiana ni identidad por método.
- 13 matrices exactas / 130 puntos + 1 fijo; cantidad 750 no disponible por interpolación.
- Revisión conserva 197 estados por confirmar y los P1 abiertos.
- Errores de dominio y de referencias impiden promoción; historial de aprobación queda trazable.

No se implementan en STEP 05A: aprobación, publicación, motor productivo de precios, CRM, Admin UI o base de datos. La integración se podrá iniciar al recibir los artefactos anteriores.
