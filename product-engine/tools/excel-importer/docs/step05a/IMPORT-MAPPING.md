# Import mapping

| Fuente | Resultado STEP 05A | Tratamiento STEP 03 / pendiente |
|---|---|---|
| OFERTAS.Oferta_ID / SKU | linaje literal | Nunca UUID ni public_code |
| OFERTAS.Nombre | texto completo normalizado | Alias dentro de slash/notas conservados; no segmentación ambigua |
| Clase Bien / Servicio | PRODUCT / SERVICE como hipótesis | Proyecto y vacíos requieren decisión; no entidad Project |
| Estado_comercial | hipótesis del vocabulario STEP 03 o null | No se usa estado del precio para inferir ACTIVE |
| Categoría_ID / Familia_ID | referencia + etiquetas de LISTAS | Ningún árbol definitivo; familias-método no se vuelven identidad |
| Unidad_predeterminada | unidad reconocida o null | Paquete en tarjetas/flyers → PIECE según mapping STEP 03; otras ambigüedades abiertas |
| Acepta_material_cliente | true / false / null | No fija automáticamente REQUIRED para cualquier fila |
| OPCIONES_OFERTA + LISTAS | opción y valores con procedencia conjunta | Semántica de cada “tamaño” pendiente; nunca cartesiano |
| modalidad Blank / Personalizada | hipótesis de política de decoración | No Option; ADR-004 |
| modalidad material / instalación | hipótesis de composición | Service destino requiere revisión |
| OWN-OP-007 talla de Gorra | evidencia y issue, sin candidato opción | Excluir defecto documentado STEP 03 |
| MIGF-OP-001, OWN-OP-009, OWN-OP-010 | evidencia de atributo fijo dentro del item | Par / dimensiones de imán y yard sign no son opciones configurables |
| OFERTA_METODO + LISTAS MET | asociación de método como hipótesis | Producción inherente ≠ decoración seleccionable; revisión explícita |
| COMPONENTES_OFERTA | 4 relaciones reales + procedencia | INCLUDED / OPTIONAL; no entidades Component independientes |
| PRECIOS + CONDICIONES_PRECIO | 131 hipótesis de precio / 23 evidencias históricas | No precio vigente; no interpolación; condiciones completas |
| PRESENTACIONES / PRESENTACIÓN_OFERTA | raw evidence | Mapping a locale/occasion/publication se adapta en STEP 05B |
| FUENTES_OFERTA | raw evidence; señal de variante si aparece SKU proveedor real | Sólo TEST en fuente actual; ninguna variante generada |
| INSUMOS, COSTOS_INSUMO, RECETAS, CONSUMO | TEST evidence | No son costos reales DTG |
| Preparacion_operativa y auxiliares | celdas preservadas | Sin asignación a CatalogStatus |
| Notas, historia, JSON embebido | literal íntegro y linaje | Decisiones y fusiones deben interpretarse y aprobarse; no auto-merge |

## Precios

La evidencia de autorización es Estado_de_precio=Confirmado y Revisado=Sí, sin texto histórico/no autorizado. Sólo `Por tabla` con extremos de cantidad explícitos, iguales y positivos se clasifica EXACT_QUANTITY_MATRIX. Fijo/Total se clasifica FIXED; su cantidad no se completa artificialmente si está vacía. Modelos o límites no interpretables se clasifican UNKNOWN_REVIEW_REQUIRED. DERIVED es una categoría conceptual reservada: no hay evidencia tabular explícita suficiente para emitirla en estos archivos.

Las condiciones se conservan por fila incluyendo opción, atributo, operador, valor y unidad. La agrupación usa item, modelo/clasificación, moneda, base de cobro y conjunto ordenado de condiciones semánticas. No agrupa sólo por nombre ni elimina la diferencia caras/papel/tamaño. 40 puntos tarjetas + 90 flyers + 1 imán = 131. Cantidad 750 nunca se inventa; Bond 2 caras nunca se inventa.

Históricos y pendientes son conceptos distintos: evidencia histórica explícita va a historical_prices; un nuevo pendiente sin declaración histórica queda UNKNOWN_REVIEW_REQUIRED. Ni una evidencia de autorización ni la clasificación de precio permiten publicar.

## Fuentes complementarias

El PDF fechado 2026-09-25 contiene precios comunicados en un contexto concreto. Faltan alcance, cantidad exacta y configuración suficientes para reemplazar tarifas. Benchmarks públicos de gorras tampoco son costos internos. Los 26 puntos waterproof citados por HITOS no están aportados como tabla: se pide su fuente, sin fabricarlos.

## Límites deliberados

No se convierte prosa a reglas de recargo, no se infiere exhaustividad de tallas, no se transforma una disponibilidad ocasional en estado, no se confirma sourcing y no se aplica el default de México sobre valores explícitos. Esas decisiones siguen visibles para el bridge y el dueño.
