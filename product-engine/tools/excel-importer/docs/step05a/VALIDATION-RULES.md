# Validation rules

Las validaciones operan antes de cualquier adaptación/persistencia. Los códigos y severidades se implementan en `parser/validation.py`. Los issues del registro principal y de sus dependencias se propagan a cada candidato.

| Comprobación | Efecto |
|---|---|
| Cabecera esperada ausente | ERROR, hoja conservada como referencia, sin tipado comercial |
| Identificador ausente | ERROR; fila no desaparece de RAW |
| Identificador repetido en workbook/tabla | ERROR en cada fila; ningún auto-upsert |
| Nombre de oferta vacío | ERROR |
| Moneda no explícita / signo $ solo | WARNING y UNKNOWN_REVIEW_REQUIRED para precio no histórico |
| Evidencias monetarias contradictorias | ERROR, moneda null |
| Importe inválido/negativo/fórmula | ERROR; sin interpretación como precio utilizable |
| Matriz sin cantidad exacta positiva y extremos iguales | ERROR; no interpolar |
| Join obligatorio con 0 o >1 filas | ERROR; conservar todas las coincidencias para diagnóstico |
| Lifecycle vacío o no reconocido | WARNING; null |
| Categoría/opción pendiente de contrato semántico | WARNING; no inventar mapping |
| Mismo item/moneda/condiciones/cantidad/base con distinto importe | ERROR de conflicto |
| Probable duplicado | WARNING con ambos registros y señales |
| Fórmula usada en columna comercial | WARNING, valor normalizado null; nunca confiar en caché |

La falta de estado, categoría o unidad no borra la evidencia. Un error REJECTED tampoco elimina el candidato del informe; impide que se confunda con uno validado. Workflow sigue pendiente en todos los casos.

Los campos de precio históricos se validan, pero jamás pasan a candidates de precio. Confirmado+Sí es evidencia documental de autorización, no una aprobación de publicación de este lote. Los precios FIXED no reciben cantidad 1 por conveniencia; esa decisión está abierta en imanes.

## Lo que estas pruebas no certifican

No certifican costos/proveedores, capacidad operativa, vigencias inferidas desde notas, exhaustividad de opciones, taxonomía final, reglas de composición cíclica en una base inexistente, reglas de identidad del runtime STEP 04 ni autorización de negocio. Las asociaciones de método requieren confirmar si son producción inherente o decoración seleccionable. Todos esos puntos quedan en revisión.

El archivo `tests/test_parser.py` prueba casos reales y mutaciones sintéticas aisladas en memoria. No escribe fixtures sintéticos en las fuentes ni recalcula los Excel. El log de ejecución final está en evidence/test-results.txt.
