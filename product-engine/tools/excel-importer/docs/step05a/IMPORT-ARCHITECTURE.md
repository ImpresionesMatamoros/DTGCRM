# Import architecture

`Excel → reader → sheet adapters → neutral normalization → validators → candidate mapper → reviewable JSON`

La implementación está separada en seis módulos. `reader.py` abre cada workbook dos veces en lectura: fórmulas y cachés. Nunca llama a save. `adapters.py` descubre la cabecera por su identificador esperado dentro de las primeras diez filas y aplica límites conocidos de columnas de negocio. Los controles fuera de esos límites siguen en la procedencia y el perfil; no alimentan el dominio.

`normalizers.py` limpia texto sin cambiar casing, distingue nulo y cadena vacía, interpreta dinero con Decimal y cantidades discretas, y reconoce medidas sin convertir unidades. `validation.py` define issues estables y señales de duplicación. `mapper.py` construye hipótesis para los cinco conceptos solicitados, usando joins explícitos. `pipeline.py` orquesta lotes, fixtures, drift y agrupaciones de precio; `report.py` genera el informe legible.

## Jerarquía de autoridad

STEP 03 gobierna conceptos; v1.2 RC es fuente actual; v1.1 sólo comparación. Costeo, comprensión y gorras son evidencia especializada. El handoff comercial explica ambigüedades, y STEP 01 sirve para reconciliar conteos. No se ejecutaron scripts contenidos en los ZIP de referencia. Los scripts de esta entrega leen nuevamente los Excel reales.

## Determinismo

Archivos ordenados por nombre, hojas en orden del workbook, filas y celdas por coordenada. IDs SHA-256 truncados a 24 hex: lote = versión + hash + nombre; registro = hash + hoja + fila; candidato = registro + tipo; issue = registro + código + detalle. JSON ordena claves y usa UTF-8. No se usa hora, aleatoriedad, red ni identidad de base de datos en resultados. La metadata temporal va separada.

Un cambio de bytes cambia el lote. Esta propiedad no reemplaza la idempotencia semántica entre versiones: STEP 05B deberá conciliar linajes mediante un mapping aprobado. No se debe hacer upsert productivo usando sólo coordenada o ID legacy.

## Aislamiento

Sólo el archivo con nombre exacto v1.2 genera candidatos. Los demás producen evidencia y comparación. TEST se detecta por identificadores con prefijo TEST-, incluidos IDs de referencias. No se generan variantes, bundles, precios derivados de México ni combinaciones cartesianas. Si se renombra la fuente principal, hay que cambiar explícitamente la configuración y la versión del parser; no se elige autoridad por contenido aproximado.

El lector no ejecuta macros, fórmulas, vínculos externos ni expresiones provenientes de notas. Los cachés pueden estar desactualizados; nunca son fallback para valores comerciales. La detección de referencias de fórmula es una ayuda de inspección por patrón, no un resolvedor completo de Excel; se conserva el texto completo para revisión.

## Alcance de seguridad semántica

Todos los candidatos quedan PENDING_REVIEW y publishable=false, incluso si pasan validaciones. Los errores conocidos los marcan REJECTED en validation_state. No existe operación para aprobar o publicar. La validación de invariantes finales de Product Engine se ejecutará después de adaptar contratos, no se simula con un esquema físico alternativo.
