# Calidad de datos (STEP 08)

Pantallas bajo `/admin/data-quality`: **Resumen** (números reales y clicables), **Problemas** (cola con filtros por regla, severidad, tipo, categoría, decisión, resoluble en masa, workbook y estado de revisión, con remediación masiva por regla), **Preparación** (revisión / dominio / precios / publicación, con razones; sin puntaje), **Inventario de reglas**, **Categorías** (mapeo con vista previa de impacto), **Duplicados** (lado a lado; sólo "son distintos" / "revisado", sin fusión) y **Commercial Print** (compuerta de sólo lectura). Exportación: `/admin/data-quality/export` (JSON con hallazgos) y `?format=csv`.

Reglas y semántica: `docs/step08/DATA_QUALITY_RULES.md`. Diseño: ADR-0018.

Decisiones: `/admin/decisions/D-xxx` muestra ABIERTA/RESPONDIDA. Registrar la respuesta del dueño requiere el rol `decision.record` (variable `DTG_DECISION_RECORDERS`; nadie lo tiene por defecto). Registrar no cambia candidatos; si la decisión tiene forma aplicable (D-001 estado, D-002 unidad de venta, D-003 producto/servicio, D-013 material del cliente) se puede previsualizar y aplicar con el flujo masivo (origen `DECISION_GROUP`).

Límites: no publica REAL, no autoriza precios, no cierra IVA/D-022, no fusiona artículos y no responde decisiones.
