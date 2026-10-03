# STEP 09 — Informe de migración Commercial Print

## Actualización — pasada Owner Decisions (cierre de STEP 09)

Después de este informe, la `OWNER_DECISION_SPEC_v1.0` resolvió las 16 filas que quedaron bloqueadas. Resultado (detalle y evidencia en `OWNER_DECISIONS_COMPLETION_REPORT.md`, `OWNER_DECISIONS_REAL_PUBLICATION_DRY_RUN.md` y `OWNER_DECISIONS_POST_QUALITY.md`):

- **Alcance 21 → 13 productos + 8 no-producto + 0 bloqueados.** Productos: los 5 de STEP 09 más 8 nuevos (Poster / Tabloide 11×17, Poster Gran Formato, Menús, Invitación sencilla, Invitación premium, Periódico personalizado — ACTIVE + QUOTE_ONLY — y Seating card y Thank-you card como CANDIDATE interno, nunca públicos).
- **No-producto con evidencia conservada** (migración 0018): alias "Invitación para evento"; configuraciones "con sobre", "con sello", "con acrílico"; estilos "formal" y "casual"; legacy no válido "Invitación especial" y "Tarjetas complementarias".
- Segundo permiso (reemplaza al primero), misma barrera global cerrada, misma compuerta por item, publicación idempotente (segunda corrida: 0 filas nuevas).
- No se creó ni autorizó ningún precio.

Lo que sigue es el informe original, sin cambios.

---

## Pasada original de STEP 09 (historial, sin cambios)

Generado por `tsx scripts/step09-report.ts post` el 2026-10-02T04:38:53.392Z.

Permiso `commercial-print-mvp` aprobado por **e2e-owner** el 2026-10-02T04:38:45.676Z (mercado USA). Motivo: E2E: el dueño autoriza la primera publicación REAL (OD-07).

## Resumen

| Medida                                      | Valor |
| ------------------------------------------- | ----- |
| Items en alcance                            | 21    |
| Publicables (superan su compuerta)          | 5     |
| Publicados bajo el permiso                  | 5     |
| Bloqueados (siguen en staging con razón)    | 16    |
| Candidatos publicados (REAL)                | 24    |
| Candidatos publicados fuera del permiso     | 0     |
| Con precio autorizado vía Price Engine      | 4     |
| ACTIVE + QUOTE_ONLY (sin precio automático) | 1     |

## Los 21 items

| ID legacy    | Item                                   | Resultado        | Código público       | Estado · unidad · categoría          | Precios       | Qué lo bloquea                                                                                                                                                                                                                                                                                |
| ------------ | -------------------------------------- | ---------------- | -------------------- | ------------------------------------ | ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| MIG1-O-008   | Tarjeta Tradicional                    | PUBLICADO (REAL) | DTG-00001 (enlazado) | ACTIVE · PIECE · impresos_papel      | 2 autorizadas | —                                                                                                                                                                                                                                                                                             |
| MIG1-O-009   | Tarjeta Premium / Gloss                | PUBLICADO (REAL) | DTG-00002 (enlazado) | ACTIVE · PIECE · impresos_papel      | 2 autorizadas | —                                                                                                                                                                                                                                                                                             |
| MIG2-O-036   | Flyers                                 | PUBLICADO (REAL) | DTG-00003 (enlazado) | ACTIVE · PIECE · impresos_papel      | 9 autorizadas | —                                                                                                                                                                                                                                                                                             |
| MIG2-O-037   | Tabloides                              | BLOQUEADO        | —                    | —                                    | QUOTE_ONLY    | Review no está READY · Domain no está READY · Decisión abierta: D-001 — Estado formal del catálogo · Decisión abierta: D-002 — Unidad de venta pendiente · El item está WARNING, no APPROVED · Sin categoría de Product Engine                                                                |
| MIG2-O-038   | Posters                                | BLOQUEADO        | —                    | —                                    | QUOTE_ONLY    | Review no está READY · Domain no está READY · Decisión abierta: D-001 — Estado formal del catálogo · Decisión abierta: D-002 — Unidad de venta pendiente · El item está WARNING, no APPROVED · Sin categoría de Product Engine                                                                |
| MIG2-O-039   | Menús                                  | BLOQUEADO        | —                    | —                                    | QUOTE_ONLY    | Review no está READY · Domain no está READY · Decisión abierta: D-001 — Estado formal del catálogo · Decisión abierta: D-002 — Unidad de venta pendiente · El item está WARNING, no APPROVED · Sin categoría de Product Engine                                                                |
| MIG2-O-040   | Postales                               | PUBLICADO (REAL) | DTG-00029 (creado)   | ACTIVE · PIECE · impresos_papel      | 0 autorizadas | —                                                                                                                                                                                                                                                                                             |
| MIG2-O-046   | Tarjetas complementarias               | BLOQUEADO        | —                    | —                                    | QUOTE_ONLY    | Review no está READY · Domain no está READY · Decisión abierta: D-001 — Estado formal del catálogo · Decisión abierta: D-002 — Unidad de venta pendiente · El item está WARNING, no APPROVED · Sin categoría de Product Engine                                                                |
| MIG2-O-047   | Seating card / place card              | BLOQUEADO        | —                    | —                                    | QUOTE_ONLY    | Review no está READY · Domain no está READY · Decisión abierta: D-001 — Estado formal del catálogo · Decisión abierta: D-002 — Unidad de venta pendiente · El item está WARNING, no APPROVED · Sin categoría de Product Engine                                                                |
| MIG2-O-048   | Thank-you card                         | BLOQUEADO        | —                    | —                                    | QUOTE_ONLY    | Review no está READY · Domain no está READY · Decisión abierta: D-001 — Estado formal del catálogo · Decisión abierta: D-002 — Unidad de venta pendiente · El item está WARNING, no APPROVED · Sin categoría de Product Engine                                                                |
| MIGF-O-008   | Invitación sencilla                    | BLOQUEADO        | —                    | —                                    | QUOTE_ONLY    | Review no está READY · Domain no está READY · Decisión abierta: D-001 — Estado formal del catálogo · Decisión abierta: D-002 — Unidad de venta pendiente · El item está WARNING, no APPROVED · Sin categoría de Product Engine                                                                |
| MIGF-O-009   | Invitación premium                     | BLOQUEADO        | —                    | —                                    | QUOTE_ONLY    | Review no está READY · Domain no está READY · Decisión abierta: D-001 — Estado formal del catálogo · Decisión abierta: D-002 — Unidad de venta pendiente · El item está WARNING, no APPROVED · Sin categoría de Product Engine                                                                |
| MIGF-O-010   | Invitación para evento                 | BLOQUEADO        | —                    | —                                    | QUOTE_ONLY    | Review no está READY · Domain no está READY · Decisión abierta: D-001 — Estado formal del catálogo · Decisión abierta: D-002 — Unidad de venta pendiente · El item está WARNING, no APPROVED · Sin categoría de Product Engine                                                                |
| MIGF-O-011   | Invitación con sobre                   | BLOQUEADO        | —                    | —                                    | QUOTE_ONLY    | Review no está READY · Domain no está READY · Decisión abierta: D-001 — Estado formal del catálogo · Decisión abierta: D-002 — Unidad de venta pendiente · El item está WARNING, no APPROVED · Sin categoría de Product Engine                                                                |
| MIGF-O-012   | Invitación con sello                   | BLOQUEADO        | —                    | —                                    | QUOTE_ONLY    | Review no está READY · Domain no está READY · Decisión abierta: D-001 — Estado formal del catálogo · Decisión abierta: D-002 — Unidad de venta pendiente · El item está WARNING, no APPROVED · Sin categoría de Product Engine                                                                |
| MIGF-O-013   | Invitación con acrílico                | BLOQUEADO        | —                    | —                                    | QUOTE_ONLY    | Review no está READY · Domain no está READY · Decisión abierta: D-001 — Estado formal del catálogo · Decisión abierta: D-002 — Unidad de venta pendiente · El item está WARNING, no APPROVED · Sin categoría de Product Engine                                                                |
| MIGF-O-014   | Invitación especial                    | BLOQUEADO        | —                    | —                                    | QUOTE_ONLY    | Review no está READY · Domain no está READY · Decisión abierta: D-001 — Estado formal del catálogo · Decisión abierta: D-002 — Unidad de venta pendiente · El item está WARNING, no APPROVED · Sin categoría de Product Engine                                                                |
| MIGF-O-015   | Imanes para vehículo — par de 2 × 1 ft | PUBLICADO (REAL) | DTG-00004 (enlazado) | ACTIVE · PAIR · servicios_especiales | 1 autorizadas | —                                                                                                                                                                                                                                                                                             |
| OWN-MT-O-046 | Periódico personalizado para eventos   | BLOQUEADO        | —                    | —                                    | QUOTE_ONLY    | Review no está READY · Domain no está READY · Decisión abierta: D-001 — Estado formal del catálogo · Decisión abierta: D-002 — Unidad de venta pendiente · Decisión abierta: D-003 — Alcance de tres tipos sin resolver · El item está WARNING, no APPROVED · Sin categoría de Product Engine |
| OWN-O-007    | Invitación formal                      | BLOQUEADO        | —                    | —                                    | QUOTE_ONLY    | Review no está READY · Domain no está READY · Decisión abierta: D-001 — Estado formal del catálogo · Decisión abierta: D-002 — Unidad de venta pendiente · El item está WARNING, no APPROVED · Sin categoría de Product Engine                                                                |
| OWN-O-008    | Invitación casual                      | BLOQUEADO        | —                    | —                                    | QUOTE_ONLY    | Review no está READY · Domain no está READY · Decisión abierta: D-001 — Estado formal del catálogo · Decisión abierta: D-002 — Unidad de venta pendiente · El item está WARNING, no APPROVED · Sin categoría de Product Engine                                                                |

## Cómo se desbloquean los 16 restantes

Ninguno se desbloquea inventando datos. Cada uno necesita una respuesta explícita del dueño (clase A/B en `OWNER_DECISION_GATE.md`): sobre todo **D-001** (¿DTG vende/cotiza hoy este item?) y **D-002** (unidad de venta). Con la respuesta registrada, el mismo flujo (decisiones → resolver → aprobar → permiso → publicar) los migra sin cambios de código.

## Procedencia

Cada item publicado conserva la cadena CatalogItem → vínculo → candidato → registro → workbook → hoja/fila/celda; ver `MVP_VERIFICATION.md` (gate E).
