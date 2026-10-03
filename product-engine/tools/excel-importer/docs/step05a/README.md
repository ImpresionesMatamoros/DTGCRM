# DTG Product Engine — STEP 05A

Entrega de descubrimiento e importación de evidencia Excel. Incluye código ejecutable, contratos TypeScript conceptuales, diez fixtures reales, pruebas y reportes por archivo. No contiene esquema productivo, migraciones, conexión a base de datos ni publicación.

## Resultado

- Se inspeccionaron los cinco workbooks y sus 58 hojas.
- La fuente principal contiene 220 ofertas reales, 79 opciones, 88 asociaciones de método, 154 precios y 325 condiciones.
- Se separan 23 precios históricos. Los otros 131 tienen evidencia de autorización: 130 puntos de matrices exactas y un precio fijo. Ninguno queda publicado ni se convierte automáticamente en precio vigente.
- Se conservan 197 estados comerciales desconocidos. No se infiere actividad a partir de un precio.
- Los controles, demos, fórmulas y filas TEST quedan como evidencia; no generan candidatos comerciales.
- Los asuntos P1 están en `DOMAIN-MAPPING-QUESTIONS.md`, incluyendo la discrepancia de CatalogStatus entre el prompt y STEP 03.

## Ejecutar

Python 3.11 o posterior y `openpyxl==3.1.5`. Desde este directorio:

```powershell
python -m pip install -r requirements.txt
python -m parser.pipeline --sources 'C:\ruta\02_SOURCE_WORKBOOKS' --output 'C:\ruta\resultado'
python -m parser.report --output 'C:\ruta\resultado'
$env:DTG_SOURCES = 'C:\ruta\02_SOURCE_WORKBOOKS'
python -m unittest discover -s tests -v
```

Para ejecutar las pruebas sobre otra copia de esta entrega, generar primero la evidencia con `--output .` desde esa copia. Las pruebas requieren los cinco archivos originales; fallan explícitamente si falta la fuente principal. No se incluyen dependencias ni otra copia de los Excel en esta entrega.

El comando de parsing es determinista para los mismos bytes, nombres y versión. `run-metadata.json` contiene tiempos reales de ejecución y se excluye de la comparación de determinismo. Los IDs de lote son direcciones de contenido, no identidades de Product Engine. La salida se puede regenerar y sustituir en un directorio de resultados; no usar ese directorio para decisiones manuales.

## Lectura recomendada

1. `EXCEL-SOURCE-PROFILE.md`: inventario, conteos, anomalías y drift.
2. `IMPORT-ARCHITECTURE.md` y `IMPORT-MAPPING.md`: alcance implementado y límites.
3. `RAW-IMPORT-CONTRACT.md`, `STAGING-CONTRACT.md`, `PROVENANCE-SPEC.md`: frontera técnica.
4. `VALIDATION-RULES.md`, `IMPORT-ERROR-TAXONOMY.md`, `DUPLICATE-DETECTION.md`: revisión.
5. `DOMAIN-MAPPING-QUESTIONS.md` y `STEP_05B-INTEGRATION-PLAN.md`: decisiones y siguiente etapa.
6. `evidence/self-audit.json`, `evidence/test-results.txt`: verificación final.

Las evidencias JSON son extensas porque conservan fórmulas y procedencia por celda. Los archivos especializados se capturan como referencia; no tienen adaptadores para inventar productos o tarifas a partir de tablas narrativas. Las notas completas se conservan, pero sus decisiones, aliases y JSON embebido no se promueven automáticamente. El bridge a los contratos definitivos pertenece a STEP 05B.

PASS WITH P1 OPEN ITEMS — READY TO ADAPT TO STEP 04 CONTRACTS
