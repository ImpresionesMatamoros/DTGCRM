# ADR-0009 — Reloj explícito en el dominio de pricing

**Estado:** ACEPTADO (STEP 04, Boundary Patch 3)

## Decisión

- Firma: `resolvePrice(request, catalogSnapshot, asOf)`. `asOf` (instante efectivo) es obligatorio.
- El dominio puro (`src/domain`, `src/pricing`, `src/api`, `src/shared`) no lee el reloj ni genera aleatoriedad. Se hace cumplir con ESLint (`no-restricted-syntax` sobre `Date.now()`, `new Date()` sin argumentos, `Math.random()`) y con una prueba que inspecciona el código fuente.
- La capa de aplicación (API futura, scripts) genera `asOf`.
- `asOf` selecciona vigencias (`valid_from`/`valid_to`) de definiciones, reglas y parámetros (FX) y se devuelve en el resultado como `effective_at`.

## Consecuencia

Mismo request + mismo snapshot + mismo `asOf` ⇒ mismo resultado, byte a byte. Base para auditoría y para re-cotizar a una fecha.
