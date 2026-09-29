BASELINE:
commit: 8d063d70e45ac84f97ca8cfb7304e8a78789844b
archivos inspeccionados: index.html, sw.js, README.md (vacío); UMD remoto @supabase/supabase-js@2.45.4; columnas, políticas RLS y Storage consultadas de solo lectura.

# Notas de integración y auditoría

## Comparación exacta

`main` se actualizó el 29 de septiembre de 2026, HEAD `8d063d70e45ac84f97ca8cfb7304e8a78789844b`. El primer paquete se construyó sobre `d72ddddcb7d4e60068daa7473ed25ff7da3d344b`. Archivos rastreados: `index.html`, `sw.js`, `README.md`; no existen JS propios separados, manifest ni iconos en esa rama. SHA-256 del `index.html` en el baseline actualizado: `c6c43e1b25841de1849bd6688fb15803c3348d1849073b9a76a01f033c2c0f2c`; `sw.js`: `fefbf952d6168786059370ced19937859ac49fff21a0ddd86505d61255a3a9dd` (sin cambios desde el primer paquete). La UMD descargada del CDN tiene SHA-256 `8596965fe918e656600a1b568d3a168f5c0d3d22a600886bb6f44a6555db01e7`. Los commits recientes ya habían incorporado chat Equipo, @Equipo y menciones, preferencias, marca de lectura, coordinación de pestañas, sonido, push opcional y un Realtime por tabla. No se reimplementaron.

## Archivos

| Tipo | Archivo | Función |
| --- | --- | --- |
| Modificado | `index.html` | Interfaz y cliente; arquitectura monolítica preservada |
| Sin cambios | `sw.js` | Push existente; no recibe nuevas reglas para mensajes personales |
| Nuevo | `ASTRA-01-communications.sql` | Esquema, índices, políticas y bucket |
| Nuevo | `supabase/functions/transcribe-chat-audio/index.ts` | Transcripción posterior a subir el audio |
| Nuevo | `ASTRA-QA.cjs` | Pruebas de parser, referencias y aislamiento del feed |
| Nuevos | `CHANGELOG-ASTRA.md`, `INTEGRATION-NOTES-ASTRA.md`, `ASTRA-against-8d063d7.patch` (archivo de auditoría externo al commit) | Comparación y traspaso |

## Esquema requerido y seguridad

`chat_conversations` guarda exactamente dos perfiles ordenados. `team_posts` recibe `conversation_id`, `reply_to_id`, `thread_root_id`, `references_data` y metadatos de audio/transcripción. `chat_ticket_links` enlaza mensajes o raíces de hilos del Equipo con tickets sin copiar el chat. `chat_later` pertenece a un usuario. El bucket `chat-private` almacena audio y se autoriza por miembro de conversación o Equipo.

La migración **reemplaza** `team_posts_select`: la política actual permite a cualquier miembro leer todos los posts. Se restringen también las reacciones que apuntan a posts. Un trigger impide mover mensajes entre conversaciones, enlazar chats personales por el mecanismo heredado y usar imágenes del bucket heredado en mensajes personales. La relación de hilo con ticket se ofrece solo en Equipo. Un chat personal no se comparte completo accidentalmente; en creación de ticket desde DM, solo se guarda el campo revisado y, si el usuario marca la casilla, una nota de texto explícita. No hay copia automática de imágenes ni audio privados.

**Riesgo preexistente observado en producción:** el bucket `ticket-files` tiene políticas `authenticated read/update/delete/upload ticket-files` permisivas además de la política por ticket. `tickets`, `tareas` y `clientes` también conservan políticas legadas `authenticated read/write ...` que se combinan por OR con otras restricciones. Esto merece una auditoría separada antes de tratar tickets privados como plenamente aislados; esta ronda no cambia esas políticas generales para no alterar módulos ajenos.

## Función y configuración externa

Para transcripción se necesita aplicar la migración en un clon/staging, crear el bucket incluido por SQL, configurar `OPENAI_API_KEY` como secreto de Edge Functions y desplegar `transcribe-chat-audio` con `verify_jwt=true`. El cliente nunca contiene la clave. La función verifica JWT, autor del mensaje, RLS de lectura y ruta del objeto antes de llamar al proveedor. No especifica idioma para conservar español/inglés. Requiere disponibilidad de la API externa y saldo de su cuenta. Se entrega código, no despliegue. Realtime existente de `team_posts` debe continuar publicado; confirmar en staging que los eventos INSERT respetan RLS para dos usuarios y un tercero.

## Funcionalidad y pruebas

| Área | Estado en el paquete | Verificación ejecutada |
| --- | --- | --- |
| Equipo, Realtime y sonidos previos | Código preservado; rama nueva sobre mismo `team_posts` | Inspección/diff; sin sesión de staging para prueba E2E |
| DM, privacidad real, fotos/archivos privados | Esquema RLS diseñado; DM de texto integrado. Fotos/archivos de DM pendientes | Auditoría estática de políticas; **RLS no ejecutado** |
| @persona, @cliente y #ticket | Picker y referencias JSON con IDs | VM: parseo, coincidencia, estructura y escape HTML |
| Reply, hilo y vínculos de Equipo | Integrados en UI/esquema | VM: conteo de hilo y exclusión del feed; vínculo DB sin E2E |
| Selección múltiple y creación revisada | Integradas para mensajes; operaciones usan núcleos existentes | Inspección y check sintáctico; flujo DB sin E2E |
| Audio y transcripción | Cliente + función preparada; función pendiente de despliegue | Check sintáctico de JS; micrófono, MIME real y proveedor sin prueba física |
| Guardados y reminders | Tabla privada, vista y timer en app abierta | Inspección; RLS/timing multisesión sin E2E |
| Push y centro de notificaciones | Push anterior conservado; **centro persistente nuevo no construido** | Sin prueba |
| Móvil/teclado | Controles táctiles y picker con flechas, Enter, Tab, Escape | Revisión de código; iPhone/Android/PWA sin prueba física |

Comandos realmente ejecutados: `node --check` sobre el script inline extraído, `node ASTRA-QA.cjs` (PASS) y `git diff --check`. No se ejecutó SQL ni prueba con cuentas reales. Se intentó iniciar Chromium de Playwright, pero la imagen de navegador no está instalada; no se marca QA visual ni E2E como aprobado.

## Pendientes y límites que no se deben confundir con terminado

- La privacidad de DM depende de **aplicar primero** la migración y probar RLS con dos miembros y un tercero. Sin migración, el selector de DM queda oculto; el chat general conserva el fallback. No poner `index.html` en producción antes de la migración.
- La transcripción, búsqueda de transcripciones reales y errores de proveedor requieren despliegue y una grabación real; si la función falla, el audio permanece, con estado `failed`.
- No hay fotos/archivos adjuntos en DM, ni compartir un hilo personal con visibilidad ampliada a participantes del ticket. Se requiere política de Storage y consentimiento claro para eso.
- No se construyeron selección por pulsación prolongada, previsualización enriquecida de archivos, detección automática de precio/anticipo/fecha, asociación de producto, edición de fuente con bandera visible, ni deduplicación de creación parcial tras falla de vínculo. La revisión es manual y la bitácora guarda snapshot del texto.
- `Para después` cubre mensajes/audio como mensaje, no aún tickets/tareas/archivos independientes; las opciones rápidas implementadas son 20 minutos, una hora, mañana aproximada (24 h) y fecha/hora, no “esta tarde”, “lunes” ni recurrencias. El vencimiento se avisa en app abierta; no hay scheduler ni push para app cerrada.
- No existe campana con `Notificaciones` frente a `Actualizaciones`, seguimiento de tickets/tareas ni eventos persistentes de asignación, bloqueo o aprobación. El alert efímero previo del chat continúa. El contador previo del Equipo no incluye DM; por ello no afirmar que la bandeja esté terminada.
- Las tareas creadas desde conversación llaman `addTareaCore`; si una escritura secundaria en bitácora falla tras crear la tarea, la UI conserva el ticket/tarea y se debe conciliar el origen manualmente. Esto requiere operación atómica o revisión posterior.
- `sw.js` no se cambió. No existe Edge Function de push desplegada en el proyecto consultado. Un push nuevo para DM necesitará destinatarios por conversación, no la lógica genérica del Equipo.

## Secuencia para otro arquitecto

1. Comparar `ASTRA-against-8d063d7.patch` (archivo de auditoría externo al commit) con el SHA arriba y revisar el SQL contra un esquema actualizado.
2. Probar la migración en staging y verificar SELECT, INSERT, UPDATE y Storage con Martin, Alexia y un tercero no participante; comprobar que reacciones y Realtime no filtran IDs o contenido.
3. Servir el HTML en staging con la función preparada y secreto configurado. Probar Safari iPhone/PWA, Chrome Android y desktop, sonido entre pestañas, grabación y formatos, navegación, tickets, KDS y regresión de los módulos intactos.
4. Resolver límites pendientes y auditar las políticas legadas permisivas antes de integración productiva.

## Rebase de la integración

El commit nuevo de `main` (`8d063d7`) modifica solo `index.html` (90 inserciones, 11 eliminaciones). Su corrección de `claseAlAparecer`, `chatFocusNonce` y `updateSmartActionsEnSitio` permanece en el archivo integrado. `ASTRA-against-8d063d7.patch` (archivo de auditoría externo al commit) ahora se calcula frente a ese commit. No se modificó `sw.js`. La prueba de interfaz y RLS en staging sigue pendiente; este commit de código no autoriza desplegar el HTML antes del SQL.
