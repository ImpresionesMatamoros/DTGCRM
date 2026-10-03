# Admin · Migración (STEP 09)

`/admin/migration` muestra el alcance (los 21 items de Commercial Print), el veredicto de cada uno (publicable / publicado / bloqueado, con sus razones exactas), el permiso vigente y lo ya publicado.

- **Ver** no escribe nada. **Simular** corre la aprobación y la publicación completas y revierte todo (también el asignador de códigos).
- **Aprobar permiso** y **Publicar bajo el permiso** requieren las capacidades `migration.approve` / `migration.publish`, que sólo tiene el rol del dueño (`DTG_MIGRATION_OWNERS`; nadie las tiene por defecto). El permiso incluye únicamente los items que superan su compuerta; publicar vuelve a evaluarla.
- La publicación REAL global sigue cerrada (`PUBLICATION_ENABLED_FOR = ['FIXTURE']`). Ver ADR-0019.

Tras publicar, el item se opera como cualquier otro: búsqueda y edición en `/admin/catalog`, precios y simulador en `/admin/pricing`, procedencia hasta la celda del Excel desde el detalle del item.

## Línea de comandos (misma lógica que la UI)

```bash
tsx scripts/step09-migrate.ts decisions   # registra OD-01..09, aplica y aprueba los candidatos elegibles
tsx scripts/step09-migrate.ts gate        # compuerta por item
tsx scripts/step09-migrate.ts dry-run     # simulación revertida
tsx scripts/step09-migrate.ts permit      # el dueño aprueba el permiso
tsx scripts/step09-migrate.ts publish     # publicación REAL acotada (idempotente)
tsx scripts/step09-report.ts pre|post     # docs/step09/*.md
bash tools/step09-rebuild.sh              # reconstrucción limpia completa
```

## Pasada Owner Decisions (cierre de STEP 09)

La página muestra además el veredicto **resuelto** (alias, configuración, estilo o legacy no válido con su producto canónico) y la métrica "Resueltos (no producto)". Esas filas no se publican ni se bloquean: su evidencia queda en staging.

```bash
tsx scripts/step09-completion-report.ts before --completion   # foto antes de aplicar
tsx scripts/step09-migrate.ts completion                      # respuestas, categorías, disposiciones, resoluciones
tsx scripts/step09-completion-report.ts pre --completion      # ensayo (antes de cualquier escritura REAL)
tsx scripts/step09-migrate.ts permit --completion             # permiso que sustituye al anterior
tsx scripts/step09-migrate.ts publish --completion            # publicación REAL acotada (idempotente)
tsx scripts/step09-completion-report.ts post --completion     # OWNER_DECISIONS_POST_QUALITY.md
```
