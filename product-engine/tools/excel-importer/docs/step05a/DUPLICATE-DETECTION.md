# Duplicate detection

Se generan propuestas de revisión, nunca fusiones. La búsqueda está acotada a ofertas reales del mismo workbook: los snapshots v1.1 y v1.2 son versiones, no duplicados comerciales entre sí.

1. EXACT_DUPLICATE: nombre normalizado idéntico (casefold, acentos y espacios exteriores sólo para comparar).
2. PROBABLE_DUPLICATE: mismos tokens después de normalización ligera de plurales, similitud Jaccard >=0.70 o mismo objeto al retirar tokens explícitos de método (UV, DTF, HTV, bordado, serigrafía).
3. RELATIONSHIP_NOT_DUPLICATE: familia X-Banner o Feather Flag compartida y señales de hardware/completo/gráfica. Se prioriza esta clase para no fusionar componentes.

Los nombres originales no cambian por estas comparaciones. Las heurísticas no son pruebas de identidad: dos servicios sobre prendas del cliente pueden compartir palabras y seguir siendo servicios distintos. La consolidación multi-método es una decisión P2 de STEP 03.

Resultado del snapshot principal: tres pares relacionados entre completo, estructura y gráfica de X-Banner; dos pares probables (servicios de bordado/serigrafía y Llavero / Llavero UV DTF); cero nombres exactamente duplicados. Véase duplicate_reviews en el JSON principal para señales, IDs y celdas completas.

Los identificadores se comprueban por separado. Un ID repetido no prueba que los objetos deban fusionarse: es un ERROR de integridad. Lista_ID se repite por diseño; la clave de fila de LISTAS es Valor_ID. SKU conserva su valor histórico y no se asigna como identidad nueva. Los 220 SKU reales de la fuente principal están vacíos.

No hay comparación semántica universal multilingüe ni normalización agresiva de marcas/modelos. Nuevas reglas requieren casos positivos y negativos, versión de parser nueva y revisión de falsos positivos.
