# STEP 09 — Dry run de publicación REAL

Generado por `tsx scripts/step09-report.ts pre` el 2026-10-02T04:38:00.492Z, **antes de cualquier escritura REAL**. La simulación crea el permiso y ejecuta la publicación completa dentro de una transacción que se **revierte** (y devuelve el asignador de códigos a su estado): no queda nada escrito.

Alcance: **21 items** (paquete STEP 05C Commercial Print) · mercado USA · eximiciones: D-022.

## Resumen

| Medida                                                    | Valor |
| --------------------------------------------------------- | ----- |
| En alcance                                                | 21    |
| PUBLISHABLE: YES                                          | 5     |
| PUBLISHABLE: NO (bloqueados, siguen en staging con razón) | 16    |
| Con precio autorizado vía Price Engine (READY)            | 4     |
| Sólo cotización (QUOTE_ONLY)                              | 17    |
| Procedencia rota                                          | 0     |

## Por item

| ID legacy    | Candidato | Nombre                                 | Código público                  | Estado | Categoría            | Unidad | Tipo    | Decoración | Opciones             | Presentaciones       | Precio     | Decisiones abiertas           | Bloqueos DQ | Adaptador                                                                                                                                                                  | Procedencia                 | PUBLISHABLE |
| ------------ | --------- | -------------------------------------- | ------------------------------- | ------ | -------------------- | ------ | ------- | ---------- | -------------------- | -------------------- | ---------- | ----------------------------- | ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------- | ----------- |
| MIG1-O-008   | f61b50a8  | Tarjeta Tradicional                    | DTG-00001 (existente)           | ACTIVE | impresos_papel       | PIECE  | PRODUCT | NONE       | 1 cand. / 0 sin res. | 0 cand. / 0 sin res. | READY      | D-022                         | 0           | OK (CATALOG_ITEM:link1 OPTION:link3 PRICE:link1 PRICE:link1)                                                                                                               | OK (4 candidatos, 0 rotos)  | YES         |
| MIG1-O-009   | acfc4425  | Tarjeta Premium / Gloss                | DTG-00002 (existente)           | ACTIVE | impresos_papel       | PIECE  | PRODUCT | NONE       | 1 cand. / 0 sin res. | 0 cand. / 0 sin res. | READY      | D-022                         | 0           | OK (CATALOG_ITEM:link1 OPTION:link3 PRICE:link1 PRICE:link1)                                                                                                               | OK (4 candidatos, 0 rotos)  | YES         |
| MIG2-O-036   | 4806c76f  | Flyers                                 | DTG-00003 (existente)           | ACTIVE | impresos_papel       | PIECE  | PRODUCT | NONE       | 3 cand. / 0 sin res. | 0 cand. / 0 sin res. | READY      | D-022                         | 0           | OK (CATALOG_ITEM:link1 OPTION:link3 OPTION:link3 OPTION:link4 PRICE:link1 PRICE:link1 PRICE:link1 PRICE:link1 PRICE:link1 PRICE:link1 PRICE:link1 PRICE:link1 PRICE:link1) | OK (13 candidatos, 0 rotos) | YES         |
| MIG2-O-037   | 03fc540a  | Tabloides                              | —                               | FALTA  | FALTA                | FALTA  | PRODUCT | FALTA      | 0 cand. / 0 sin res. | 0 cand. / 0 sin res. | QUOTE_ONLY | D-001 D-002                   | 5           | NO (UNRESOLVED_FIELD)                                                                                                                                                      | OK (2 candidatos, 0 rotos)  | NO          |
| MIG2-O-038   | 023186bc  | Posters                                | —                               | FALTA  | FALTA                | FALTA  | PRODUCT | FALTA      | 0 cand. / 0 sin res. | 0 cand. / 0 sin res. | QUOTE_ONLY | D-001 D-002                   | 5           | NO (UNRESOLVED_FIELD)                                                                                                                                                      | OK (2 candidatos, 0 rotos)  | NO          |
| MIG2-O-039   | 6382e057  | Menús                                  | —                               | FALTA  | FALTA                | FALTA  | PRODUCT | FALTA      | 1 cand. / 1 sin res. | 1 cand. / 1 sin res. | QUOTE_ONLY | D-001 D-002 D-004 D-005       | 10          | NO (UNRESOLVED_FIELD)                                                                                                                                                      | OK (4 candidatos, 0 rotos)  | NO          |
| MIG2-O-040   | 35bcd7bd  | Postales                               | DTG-00029 (nuevo, no reservado) | ACTIVE | impresos_papel       | PIECE  | PRODUCT | NONE       | 0 cand. / 0 sin res. | 0 cand. / 0 sin res. | QUOTE_ONLY | —                             | 0           | OK (CATALOG_ITEM:crea1)                                                                                                                                                    | OK (1 candidatos, 0 rotos)  | YES         |
| MIG2-O-046   | b988a8d5  | Tarjetas complementarias               | —                               | FALTA  | FALTA                | FALTA  | PRODUCT | FALTA      | 0 cand. / 0 sin res. | 0 cand. / 0 sin res. | QUOTE_ONLY | D-001 D-002                   | 4           | NO (UNRESOLVED_FIELD)                                                                                                                                                      | OK (1 candidatos, 0 rotos)  | NO          |
| MIG2-O-047   | 558330be  | Seating card / place card              | —                               | FALTA  | FALTA                | FALTA  | PRODUCT | FALTA      | 0 cand. / 0 sin res. | 0 cand. / 0 sin res. | QUOTE_ONLY | D-001 D-002                   | 4           | NO (UNRESOLVED_FIELD)                                                                                                                                                      | OK (1 candidatos, 0 rotos)  | NO          |
| MIG2-O-048   | 971a3a72  | Thank-you card                         | —                               | FALTA  | FALTA                | FALTA  | PRODUCT | FALTA      | 0 cand. / 0 sin res. | 0 cand. / 0 sin res. | QUOTE_ONLY | D-001 D-002                   | 4           | NO (UNRESOLVED_FIELD)                                                                                                                                                      | OK (1 candidatos, 0 rotos)  | NO          |
| MIGF-O-008   | 832bd503  | Invitación sencilla                    | —                               | FALTA  | FALTA                | FALTA  | PRODUCT | FALTA      | 0 cand. / 0 sin res. | 0 cand. / 0 sin res. | QUOTE_ONLY | D-001 D-002 D-018             | 4           | NO (UNRESOLVED_FIELD)                                                                                                                                                      | OK (1 candidatos, 0 rotos)  | NO          |
| MIGF-O-009   | c679b624  | Invitación premium                     | —                               | FALTA  | FALTA                | FALTA  | PRODUCT | FALTA      | 0 cand. / 0 sin res. | 0 cand. / 0 sin res. | QUOTE_ONLY | D-001 D-002 D-018             | 4           | NO (UNRESOLVED_FIELD)                                                                                                                                                      | OK (1 candidatos, 0 rotos)  | NO          |
| MIGF-O-010   | 59c6209a  | Invitación para evento                 | —                               | FALTA  | FALTA                | FALTA  | PRODUCT | FALTA      | 0 cand. / 0 sin res. | 3 cand. / 3 sin res. | QUOTE_ONLY | D-001 D-002 D-018             | 4           | NO (UNRESOLVED_FIELD)                                                                                                                                                      | OK (4 candidatos, 0 rotos)  | NO          |
| MIGF-O-011   | 256aac59  | Invitación con sobre                   | —                               | FALTA  | FALTA                | FALTA  | PRODUCT | FALTA      | 0 cand. / 0 sin res. | 0 cand. / 0 sin res. | QUOTE_ONLY | D-001 D-002 D-018             | 4           | NO (UNRESOLVED_FIELD)                                                                                                                                                      | OK (1 candidatos, 0 rotos)  | NO          |
| MIGF-O-012   | c638d5c1  | Invitación con sello                   | —                               | FALTA  | FALTA                | FALTA  | PRODUCT | FALTA      | 0 cand. / 0 sin res. | 0 cand. / 0 sin res. | QUOTE_ONLY | D-001 D-002 D-018             | 4           | NO (UNRESOLVED_FIELD)                                                                                                                                                      | OK (1 candidatos, 0 rotos)  | NO          |
| MIGF-O-013   | 1c055cdb  | Invitación con acrílico                | —                               | FALTA  | FALTA                | FALTA  | PRODUCT | FALTA      | 2 cand. / 2 sin res. | 0 cand. / 0 sin res. | QUOTE_ONLY | D-001 D-002 D-004 D-005 D-018 | 9           | NO (UNRESOLVED_FIELD)                                                                                                                                                      | OK (3 candidatos, 0 rotos)  | NO          |
| MIGF-O-014   | 9806a454  | Invitación especial                    | —                               | FALTA  | FALTA                | FALTA  | PRODUCT | FALTA      | 0 cand. / 0 sin res. | 0 cand. / 0 sin res. | QUOTE_ONLY | D-001 D-002 D-018             | 4           | NO (UNRESOLVED_FIELD)                                                                                                                                                      | OK (1 candidatos, 0 rotos)  | NO          |
| MIGF-O-015   | 3284e251  | Imanes para vehículo — par de 2 × 1 ft | DTG-00004 (existente)           | ACTIVE | servicios_especiales | PAIR   | PRODUCT | NONE       | 0 cand. / 0 sin res. | 0 cand. / 0 sin res. | READY      | D-009 D-022                   | 0           | OK (CATALOG_ITEM:link1 PRICE:link1)                                                                                                                                        | OK (2 candidatos, 0 rotos)  | YES         |
| OWN-MT-O-046 | 7b58d729  | Periódico personalizado para eventos   | —                               | FALTA  | FALTA                | FALTA  | —       | FALTA      | 0 cand. / 0 sin res. | 0 cand. / 0 sin res. | QUOTE_ONLY | D-001 D-002 D-003             | 5           | NO (KIND_UNRESOLVED, UNRESOLVED_FIELD)                                                                                                                                     | OK (1 candidatos, 0 rotos)  | NO          |
| OWN-O-007    | cade5fda  | Invitación formal                      | —                               | FALTA  | FALTA                | FALTA  | PRODUCT | FALTA      | 0 cand. / 0 sin res. | 0 cand. / 0 sin res. | QUOTE_ONLY | D-001 D-002 D-018             | 4           | NO (UNRESOLVED_FIELD)                                                                                                                                                      | OK (1 candidatos, 0 rotos)  | NO          |
| OWN-O-008    | 4e68a84d  | Invitación casual                      | —                               | FALTA  | FALTA                | FALTA  | PRODUCT | FALTA      | 0 cand. / 0 sin res. | 0 cand. / 0 sin res. | QUOTE_ONLY | D-001 D-002 D-018             | 4           | NO (UNRESOLVED_FIELD)                                                                                                                                                      | OK (1 candidatos, 0 rotos)  | NO          |

## Razones

### MIG1-O-008 — Tarjeta Tradicional

- PUBLISHABLE: **YES**
- Pasa su compuerta: revisión, dominio, precio, decisiones (con eximiciones), procedencia y categoría.

### MIG1-O-009 — Tarjeta Premium / Gloss

- PUBLISHABLE: **YES**
- Pasa su compuerta: revisión, dominio, precio, decisiones (con eximiciones), procedencia y categoría.

### MIG2-O-036 — Flyers

- PUBLISHABLE: **YES**
- Pasa su compuerta: revisión, dominio, precio, decisiones (con eximiciones), procedencia y categoría.

### MIG2-O-037 — Tabloides

- PUBLISHABLE: **NO**
- Review no está READY
- Domain no está READY
- Decisión abierta: D-001 — Estado formal del catálogo
- Decisión abierta: D-002 — Unidad de venta pendiente
- El item está WARNING, no APPROVED
- Sin categoría de Product Engine
- Bloqueos Data Quality: DQ-CATALOG-002 · Estado de catálogo sin resolver (D-001) · DQ-CATALOG-003 · Unidad de venta ausente (D-002) · DQ-CATALOG-005 · Política de decoración sin resolver · DQ-DECOR-001 · Método de decoración sin clasificar · DQ-CATALOG-004 · Categoría sin mapear (requisito de la compuerta de migración)

### MIG2-O-038 — Posters

- PUBLISHABLE: **NO**
- Review no está READY
- Domain no está READY
- Decisión abierta: D-001 — Estado formal del catálogo
- Decisión abierta: D-002 — Unidad de venta pendiente
- El item está WARNING, no APPROVED
- Sin categoría de Product Engine
- Bloqueos Data Quality: DQ-CATALOG-002 · Estado de catálogo sin resolver (D-001) · DQ-CATALOG-003 · Unidad de venta ausente (D-002) · DQ-CATALOG-005 · Política de decoración sin resolver · DQ-DECOR-001 · Método de decoración sin clasificar · DQ-CATALOG-004 · Categoría sin mapear (requisito de la compuerta de migración)

### MIG2-O-039 — Menús

- PUBLISHABLE: **NO**
- Review no está READY
- Domain no está READY
- Decisión abierta: D-001 — Estado formal del catálogo
- Decisión abierta: D-002 — Unidad de venta pendiente
- El item está WARNING, no APPROVED
- Sin categoría de Product Engine
- Bloqueos Data Quality: DQ-CATALOG-002 · Estado de catálogo sin resolver (D-001) · DQ-CATALOG-003 · Unidad de venta ausente (D-002) · DQ-CATALOG-005 · Política de decoración sin resolver · DQ-DECOR-001 · Método de decoración sin clasificar · DQ-CATALOG-004 · Categoría sin mapear (requisito de la compuerta de migración) · DQ-OPTION-001 · Opción obligatoria sin resolver (D-004) (+4)

### MIG2-O-040 — Postales

- PUBLISHABLE: **YES**
- Pasa su compuerta: revisión, dominio, precio, decisiones (con eximiciones), procedencia y categoría.

### MIG2-O-046 — Tarjetas complementarias

- PUBLISHABLE: **NO**
- Review no está READY
- Domain no está READY
- Decisión abierta: D-001 — Estado formal del catálogo
- Decisión abierta: D-002 — Unidad de venta pendiente
- El item está WARNING, no APPROVED
- Sin categoría de Product Engine
- Bloqueos Data Quality: DQ-CATALOG-002 · Estado de catálogo sin resolver (D-001) · DQ-CATALOG-003 · Unidad de venta ausente (D-002) · DQ-CATALOG-005 · Política de decoración sin resolver · DQ-CATALOG-004 · Categoría sin mapear (requisito de la compuerta de migración)

### MIG2-O-047 — Seating card / place card

- PUBLISHABLE: **NO**
- Review no está READY
- Domain no está READY
- Decisión abierta: D-001 — Estado formal del catálogo
- Decisión abierta: D-002 — Unidad de venta pendiente
- El item está WARNING, no APPROVED
- Sin categoría de Product Engine
- Bloqueos Data Quality: DQ-CATALOG-002 · Estado de catálogo sin resolver (D-001) · DQ-CATALOG-003 · Unidad de venta ausente (D-002) · DQ-CATALOG-005 · Política de decoración sin resolver · DQ-CATALOG-004 · Categoría sin mapear (requisito de la compuerta de migración)

### MIG2-O-048 — Thank-you card

- PUBLISHABLE: **NO**
- Review no está READY
- Domain no está READY
- Decisión abierta: D-001 — Estado formal del catálogo
- Decisión abierta: D-002 — Unidad de venta pendiente
- El item está WARNING, no APPROVED
- Sin categoría de Product Engine
- Bloqueos Data Quality: DQ-CATALOG-002 · Estado de catálogo sin resolver (D-001) · DQ-CATALOG-003 · Unidad de venta ausente (D-002) · DQ-CATALOG-005 · Política de decoración sin resolver · DQ-CATALOG-004 · Categoría sin mapear (requisito de la compuerta de migración)

### MIGF-O-008 — Invitación sencilla

- PUBLISHABLE: **NO**
- Review no está READY
- Domain no está READY
- Decisión abierta: D-001 — Estado formal del catálogo
- Decisión abierta: D-002 — Unidad de venta pendiente
- El item está WARNING, no APPROVED
- Sin categoría de Product Engine
- Bloqueos Data Quality: DQ-CATALOG-002 · Estado de catálogo sin resolver (D-001) · DQ-CATALOG-003 · Unidad de venta ausente (D-002) · DQ-CATALOG-005 · Política de decoración sin resolver · DQ-CATALOG-004 · Categoría sin mapear (requisito de la compuerta de migración)

### MIGF-O-009 — Invitación premium

- PUBLISHABLE: **NO**
- Review no está READY
- Domain no está READY
- Decisión abierta: D-001 — Estado formal del catálogo
- Decisión abierta: D-002 — Unidad de venta pendiente
- El item está WARNING, no APPROVED
- Sin categoría de Product Engine
- Bloqueos Data Quality: DQ-CATALOG-002 · Estado de catálogo sin resolver (D-001) · DQ-CATALOG-003 · Unidad de venta ausente (D-002) · DQ-CATALOG-005 · Política de decoración sin resolver · DQ-CATALOG-004 · Categoría sin mapear (requisito de la compuerta de migración)

### MIGF-O-010 — Invitación para evento

- PUBLISHABLE: **NO**
- Review no está READY
- Domain no está READY
- Decisión abierta: D-001 — Estado formal del catálogo
- Decisión abierta: D-002 — Unidad de venta pendiente
- El item está WARNING, no APPROVED
- Sin categoría de Product Engine
- Bloqueos Data Quality: DQ-CATALOG-002 · Estado de catálogo sin resolver (D-001) · DQ-CATALOG-003 · Unidad de venta ausente (D-002) · DQ-CATALOG-005 · Política de decoración sin resolver · DQ-CATALOG-004 · Categoría sin mapear (requisito de la compuerta de migración)

### MIGF-O-011 — Invitación con sobre

- PUBLISHABLE: **NO**
- Review no está READY
- Domain no está READY
- Decisión abierta: D-001 — Estado formal del catálogo
- Decisión abierta: D-002 — Unidad de venta pendiente
- El item está WARNING, no APPROVED
- Sin categoría de Product Engine
- Bloqueos Data Quality: DQ-CATALOG-002 · Estado de catálogo sin resolver (D-001) · DQ-CATALOG-003 · Unidad de venta ausente (D-002) · DQ-CATALOG-005 · Política de decoración sin resolver · DQ-CATALOG-004 · Categoría sin mapear (requisito de la compuerta de migración)

### MIGF-O-012 — Invitación con sello

- PUBLISHABLE: **NO**
- Review no está READY
- Domain no está READY
- Decisión abierta: D-001 — Estado formal del catálogo
- Decisión abierta: D-002 — Unidad de venta pendiente
- El item está WARNING, no APPROVED
- Sin categoría de Product Engine
- Bloqueos Data Quality: DQ-CATALOG-002 · Estado de catálogo sin resolver (D-001) · DQ-CATALOG-003 · Unidad de venta ausente (D-002) · DQ-CATALOG-005 · Política de decoración sin resolver · DQ-CATALOG-004 · Categoría sin mapear (requisito de la compuerta de migración)

### MIGF-O-013 — Invitación con acrílico

- PUBLISHABLE: **NO**
- Review no está READY
- Domain no está READY
- Decisión abierta: D-001 — Estado formal del catálogo
- Decisión abierta: D-002 — Unidad de venta pendiente
- El item está WARNING, no APPROVED
- Sin categoría de Product Engine
- Bloqueos Data Quality: DQ-CATALOG-002 · Estado de catálogo sin resolver (D-001) · DQ-CATALOG-003 · Unidad de venta ausente (D-002) · DQ-CATALOG-005 · Política de decoración sin resolver · DQ-CATALOG-004 · Categoría sin mapear (requisito de la compuerta de migración) · DQ-OPTION-001 · Opción obligatoria sin resolver (D-004) · DQ-OPTION-002 · Definición de opción sin resolver / nombre genérico (D-005) (+3)

### MIGF-O-014 — Invitación especial

- PUBLISHABLE: **NO**
- Review no está READY
- Domain no está READY
- Decisión abierta: D-001 — Estado formal del catálogo
- Decisión abierta: D-002 — Unidad de venta pendiente
- El item está WARNING, no APPROVED
- Sin categoría de Product Engine
- Bloqueos Data Quality: DQ-CATALOG-002 · Estado de catálogo sin resolver (D-001) · DQ-CATALOG-003 · Unidad de venta ausente (D-002) · DQ-CATALOG-005 · Política de decoración sin resolver · DQ-CATALOG-004 · Categoría sin mapear (requisito de la compuerta de migración)

### MIGF-O-015 — Imanes para vehículo — par de 2 × 1 ft

- PUBLISHABLE: **YES**
- Pasa su compuerta: revisión, dominio, precio, decisiones (con eximiciones), procedencia y categoría.

### OWN-MT-O-046 — Periódico personalizado para eventos

- PUBLISHABLE: **NO**
- Review no está READY
- Domain no está READY
- Decisión abierta: D-001 — Estado formal del catálogo
- Decisión abierta: D-002 — Unidad de venta pendiente
- Decisión abierta: D-003 — Alcance de tres tipos sin resolver
- El item está WARNING, no APPROVED
- Sin categoría de Product Engine
- Bloqueos Data Quality: DQ-CATALOG-001 · Producto/Servicio sin resolver (D-003) · DQ-CATALOG-002 · Estado de catálogo sin resolver (D-001) · DQ-CATALOG-003 · Unidad de venta ausente (D-002) · DQ-CATALOG-005 · Política de decoración sin resolver · DQ-CATALOG-004 · Categoría sin mapear (requisito de la compuerta de migración)

### OWN-O-007 — Invitación formal

- PUBLISHABLE: **NO**
- Review no está READY
- Domain no está READY
- Decisión abierta: D-001 — Estado formal del catálogo
- Decisión abierta: D-002 — Unidad de venta pendiente
- El item está WARNING, no APPROVED
- Sin categoría de Product Engine
- Bloqueos Data Quality: DQ-CATALOG-002 · Estado de catálogo sin resolver (D-001) · DQ-CATALOG-003 · Unidad de venta ausente (D-002) · DQ-CATALOG-005 · Política de decoración sin resolver · DQ-CATALOG-004 · Categoría sin mapear (requisito de la compuerta de migración)

### OWN-O-008 — Invitación casual

- PUBLISHABLE: **NO**
- Review no está READY
- Domain no está READY
- Decisión abierta: D-001 — Estado formal del catálogo
- Decisión abierta: D-002 — Unidad de venta pendiente
- El item está WARNING, no APPROVED
- Sin categoría de Product Engine
- Bloqueos Data Quality: DQ-CATALOG-002 · Estado de catálogo sin resolver (D-001) · DQ-CATALOG-003 · Unidad de venta ausente (D-002) · DQ-CATALOG-005 · Política de decoración sin resolver · DQ-CATALOG-004 · Categoría sin mapear (requisito de la compuerta de migración)
