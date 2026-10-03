# Visor de precios (MVP)

Sólo lectura. **No** es todavía Pricing Productionization.

## Qué muestra `/admin/pricing/[id]`

- **PriceDefinitions**: todas (DRAFT, AUTHORIZED, SUPERSEDED), con libro, mercado, moneda, modelo, vigencia, autorizador y estado.
- **Matrices**: las definiciones del mismo libro, modelo, estado y cantidades se muestran como una tabla. Filas = cantidades exactas; columnas = conjunto de condiciones (p. ej. `caras = 1 cara`). Los importes son los de `price_break`, sin recalcular.
- **Condiciones** legibles (opción = valor, método) y **reglas** asignadas (recargos 2XL/3XL).
- **Procedencia** por definición (`EXCEL_ROW` y candidatos de importación).
- **México**: libro `MX_DERIVED`, factor default, política del item (o INHERIT si no hay), FX vigente con su id, redondeo `HALF_UP_2` marcado **PROVISIONAL TECHNICAL BEHAVIOR** (P1-02) e **IVA sin resolver**. Para cada definición USA autorizada, una tabla por cantidad con USA base, factor y su origen, FX, redondeo y el derivado MXN. **Todo viene de `resolvePrice`** (mercado MX) con un instante explícito (ADR-0009); React no multiplica nada.
- **Simulador**: elige mercado, cantidad y opciones. El servidor ejecuta `resolvePrice` y devuelve el resultado (RESOLVED, QUOTE_ONLY con motivo, INVALID o AMBIGUOUS), el desglose y la derivación.
- **Evidencia histórica** en su propia sección: "Historical evidence · Not used for current pricing".

## Autorizar precios

El botón **Authorize price** existe pero está deshabilitado con la razón: no hay un autorizador definido (P1-06). No existe ninguna Server Action de autorización y la capacidad `price.authorize` no se otorga a nadie (`permissions.ts`). Cuando el dueño defina quién autoriza, se agrega el rol `price_authorizer` y una action que cumpla lo que la base ya exige (`authorized_by`/`authorized_at`, sin solapes, breaks presentes).

## Históricos

`/admin/pricing/historical` lista la evidencia del staging (`import_record.evidence_class = 'HISTORICAL_PRICE'`) y la del dominio (`source_reference` `HISTORICAL_PRICE_EVIDENCE`). No hay ningún botón. Nunca son `price_definition` (ADR-0005). La base impide que un registro histórico alimente un candidato PRICE, y el snapshot de pricing sólo carga definiciones AUTHORIZED/SUPERSEDED.

> STEP 07: el visor es ahora un administrador de precios (borradores, revisiones, autorización local, políticas, FX, preparación Commercial Print). Ver `docs/step07/`.
