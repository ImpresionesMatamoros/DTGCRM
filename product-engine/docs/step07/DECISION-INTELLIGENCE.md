# Inteligencia de decisiones

Las decisiones D-001…D-022 de STEP 05C (10 P1, 12 P2) se cargan como **referencia estática de sólo lectura** (`src/decisions/`, fuente sha256 `8a234fc0…`). La UI (`/admin/decisions`, `/admin/decisions/[id]`) las enlaza con candidatos de staging por id legado y con ítems de precio, y abre la Review Inbox. **La app no responde decisiones ni las resuelve por inferencia.**

Notas con efecto de pricing: D-008 (alcance del recargo de prendas), D-010 (imanes), D-011 (yard sign), D-016 (autorización), D-022 (IVA sin resolver). México: redondeo HALF_UP_2 etiquetado “PROVISIONAL TECHNICAL BEHAVIOR”.
