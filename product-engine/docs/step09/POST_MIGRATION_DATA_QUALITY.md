# STEP 09 — Calidad de datos después de la migración

Generado por `tsx scripts/step09-report.ts post` el 2026-10-02T04:38:53.392Z. Las reglas son las 52 de STEP 08 (sin cambios de reglas); se recomputan sobre el staging real.

## Antes y después (todo el staging real)

| Medida                     | STEP 08 (baseline) | Tras aplicar OD-01..09 | Tras la publicación |
| -------------------------- | ------------------ | ---------------------- | ------------------- |
| Candidatos                 | 413                | —                      | 407                 |
| Hallazgos                  | 1281               | —                      | 1212                |
| Bloqueantes                | 1053               | —                      | 989                 |
| Advertencias               | 224                | —                      | 219                 |
| Esperan decisión del dueño | 691                | —                      | 678                 |

## Los 21 items de Commercial Print

| Medida                  | STEP 08 (baseline) | Después |
| ----------------------- | ------------------ | ------- |
| Items que podían migrar | 0                  | 5       |
| Publicados              | 0                  | 5       |
| Revisión lista          | 0                  | 5       |
| Dominio listo           | 0                  | 5       |
| Precio listo            | 0                  | 4       |
| Sólo cotización         | 17                 | 17      |
| Sin estado              | 21                 | 16      |
| Sin categoría           | 21                 | 16      |
| Sin unidad de venta     | 18                 | 16      |
| Procedencia rota        | 0                  | 0       |

Los hallazgos de los 16 items bloqueados **no se ocultaron ni se eximieron**: siguen en la lista con su decisión de dueño.

## Lo que NO cambió

- Los hallazgos de las demás categorías: intactos; nada fuera del alcance se publicó (0 candidatos publicados fuera del permiso).
- La etiqueta de categoría legacy se conserva como evidencia en los 5 candidatos publicados (el mapeo es una asignación aparte).
