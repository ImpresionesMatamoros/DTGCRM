# Domain mapping questions

Estas preguntas no autorizan cambios de dominio. Los IDs Q-* identifican decisiones de esta entrega; los P1/P2 citados conservan los de STEP 03. No bloquean el descubrimiento técnico, pero sí determinadas adaptaciones/publicaciones.

| ID / prioridad | Evidencia | Decisión requerida / tratamiento actual |
|---|---|---|
| Q-01 P1 | Prompt 05A §19 vs STEP 03 LOGICAL-DATA-MODEL §2.2 / ADR-002 | Prompt: ACTIVE/PLANNED/DISCONTINUED/ARCHIVED; arquitectura: CANDIDATE/PLANNED/ACTIVE/RETIRED. Confirmar enum de STEP 04. Sólo hipótesis STEP 03, null desconocido; no quinto estado |
| Q-02 P1 | MIGRATION-MAPPING §2 vs prompt 05A §12 | Mapping anterior propone blanco→false en Obligatoria; prompt exige desconocido separado. Se conserva null; bridge no debe aplicar default sin decisión |
| Q-03 P1 | STEP 03 IMPLEMENTATION-READINESS P1-01; 197 blancos en OFERTAS.L | Confirmar lifecycle por item. Tarjetas/flyers/imanes no se activan por tener tarifa |
| Q-04 P1 | STEP 03 P1-02/P1-06 | Redondeo e IVA México, quién autoriza precios y evidencia de aprobación; sin política productiva aquí |
| Q-05 P1 | STEP 03 P1-03; MIGF-O-015 y tarifa fija 65 USD | Cantidad de pares y venta múltiple. Cantidad fuente vacía se conserva; no extrapolar 2 pares=130 |
| Q-06 P1 | STEP 03 P1-04/P1-05 | Formato public_code y alcance por producto de recargos 2XL/3XL; no generar códigos ni reglas desde notas |
| Q-07 P1 técnico | STEP 03 ADR-006 / extract_output vs modelo §7.1–7.2 | 131 observaciones: 130 breaks exactos + 1 FIXED, no 131 breaks necesariamente. Adaptar la representación de imanes a contrato final sin cambiar precio |
| Q-08 P2 | Comprehension HITOS fila 4 | Se citan 26 precios waterproof; falta tabla fuente. Conservar claim, solicitar evidencia antes de importar |
| Q-09 P2 | Gorras Benchmark_Blanks / Propuesta_DTG; PDF 2026-09-25 p.1 | Benchmark/propuesta/comunicación contextual no equivale a tarifa vigente ni costo de DTG. Confirmar alcance de $5–11, $16 y $12 antes de cualquier promoción |
| Q-10 P2 | OFERTAS.Clase vacíos y Proyecto | Determinar PRODUCT/SERVICE; no crear entidad Project ni elegir sin revisión |
| Q-11 P2 | OPCIONES_OFERTA “tamaño”; STEP 03 §4 | Definir semánticas separadas de papel, display, bandera, capacidad; no reutilizar una opción genérica global |
| Q-12 P2 | OFERTA_METODO; STEP 03 ADR-004 | Distinguir decoración elegible de impresión inherente. DTF Transfer y Gang Sheet son productos separados del método DTF |
| Q-13 P2 | STEP 03 P2-01/02/04/05/07 | Tallas, yard sign exacto vs umbral, Service multi-método, unidad/status DTF, compatibilidad dimensional de componentes |
| Q-14 P2 | STEP 03 P2-08/09/10/12/13 | Canopy, sourcing, contenedores/invitaciones, vocabulario de ubicación, taxonomía PIN/FAB/FOT/PPE |
| Q-15 P2 técnico | Notas con fusiones, decisiones y JSON embebido | Aprobar interpretación explícita y enlaces de linaje; texto íntegro preservado, sin auto-merge |

## Discrepancias observadas que no requieren inventar datos

El banner LISTAS!K3 dice 103 tarifas, la lectura de filas arroja 131. El mapa de comprensión reporta 219 identidades; OFERTAS principal tiene 220 registros reales. Se respeta la fuente principal y se anotan las diferencias, sin modificar archivos. Los 23 históricos quedan fuera de staging de precios.

Los issues por registro usan IMPORT_DOMAIN_MAPPING_QUESTION, IMPORT_UNKNOWN_STATUS, IMPORT_UNMAPPED_CATEGORY e IMPORT_UNMAPPED_OPTION. Estas preguntas globales complementan esas ubicaciones; no las reemplazan.
