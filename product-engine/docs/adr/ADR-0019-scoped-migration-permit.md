# ADR-0019 — Permiso de migración acotado y publicación REAL por item

**Estado:** ACEPTADO (STEP 09)

## Contexto

Hasta STEP 08 sólo los datos FIXTURE podían escribir en el dominio (`PUBLICATION_ENABLED_FOR = ['FIXTURE']`). STEP 09 necesita publicar el primer lote REAL (Commercial Print) sin abrir REAL en general: otras categorías, otros candidatos y otros actores deben seguir bloqueados, y cada publicación debe poder auditarse hasta la celda del Excel.

## Decisión

1. **La barrera global no se toca.** `PUBLICATION_ENABLED_FOR` sigue siendo `['FIXTURE']` (hay una prueba que lo exige, y otra que prohíbe reasignarlo). `publishCandidate` acepta un `permitId` opcional; sólo entonces, y sólo para ese candidato, el adaptador recibe `REAL` como clase habilitada.
2. **Permiso mínimo y append-only** (migración 0017): `migration_permit` (alcance, mercados, aprobador, fecha, motivo, referencias a las respuestas de decisión, decisiones eximidas, ids legacy del alcance, `supersedes_id`), `migration_permit_item` (los candidatos exactos incluidos) y `migration_publication` (un renglón por candidato publicado: actor, hora, resultado; `candidate_id` único ⇒ no hay doble publicación). Revocar es insertar un renglón REVOKED que sustituye al permiso. Un trigger diferido rechaza una publicación cuyo candidato no esté en un permiso activo (defensa en profundidad). Sin UPDATE/DELETE; auditoría `record_change('IMPORT')`.
3. **Compuerta por item** (`src/migration/gate.ts`, pura): se combina la preparación de STEP 08 (revisión, dominio, precio, procedencia, categoría, decisiones) con las eximiciones del permiso. La única eximición definida es de **mercado**: D-022 (México) no bloquea un permiso sólo-USA (OD-09). Ninguna otra decisión se exime. Un item ya publicado queda PUBLISHED aunque después cambie una respuesta.
4. **Tres actos explícitos**, ninguno implícito: aprobar el permiso (`migration.approve`), simular (todo se revierte, el asignador de códigos vuelve a su estado) y publicar (`migration.publish`). Ambas capacidades las tiene sólo el rol `local_migration_owner` (`DTG_MIGRATION_OWNERS`; OD-05/OD-07: Martín). Importar, aprobar un candidato, cargar una página o arrancar la app nunca publican. La autorización es delegable cambiando `ROLE_GRANTS`, sin tocar el dominio.
5. **Publicación por item, atómica e idempotente**: cada item en su savepoint, en orden item → opciones → decoración → precios → presentaciones; se vuelve a evaluar la compuerta en el momento de publicar; un item ya publicado se salta. Los items que ya existían en el dominio (capa dev slice de STEP 03) se **enlazan** (`LINKED_EXISTING`, el adaptador verifica que el precio de la fuente coincide con el autorizado) en vez de duplicarse; los nuevos reciben `DTG-NNNNN` del asignador existente.
6. **El motor de precios no cambia.** La migración no crea ni autoriza precios: los precios vigentes son los ya AUTORIZADOS; lo demás es `QUOTE_ONLY`. `ACTIVE + QUOTE_ONLY` es un estado válido.

## Consecuencias

Una migración (0017), un módulo puro, un servicio de BD y una página de Admin. La publicación REAL de otra categoría exigiría un permiso nuevo con su propio alcance. Límite conocido: el permiso valida el estado al publicar, no a perpetuidad; si cambian las decisiones, un item sin publicar vuelve a bloquearse.
