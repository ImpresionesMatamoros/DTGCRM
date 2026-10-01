# Inicio y conversación con referencia WhatsApp

## Comportamiento

- Abrir la app muestra Chats, aunque la última vista guardada fuera otra. Se conservan entradas explícitas por URL de ticket/notificación y pantallas operativas.
- Inicio es una lista vertical: foto/iniciales, nombre, último mensaje o Foto/Audio/Documento, fecha/hora y unread. Orden por última actividad. No muestra mensajes del equipo ni compositor.
- Búsqueda y accesos de trabajo empiezan ocultos. Aparecen al desplazar, tirar de la lista hacia abajo o usar `/`/Ctrl+K en desktop. El menú sigue dando acceso al CRM y a la cuenta.
- Abrir chat muestra únicamente volver, foto/nombre y accesos de ticket/tarea/recordatorio. Sin marca del CRM, carrusel de contactos ni encabezados duplicados.
- Texto en burbujas de ancho según contenido; recibido a izquierda, propio a derecha; hora pequeña abajo a derecha. DM sin nombre/avatar por mensaje. Equipo mantiene nombre mínimo para distinguir autores. Fotos conservan su relación de aspecto.
- Acciones ocultas hasta hover; móvil usa mantener presionado para menú y deslizar para responder. Se conservan hilos, tickets, borrados y reacciones. Crear tarea desde un mensaje ahora usa menú y confirmación (tres clics), porque se retiró el botón permanente solicitado; Kanban conserva dos clics.
- Una palomita significa guardado en servidor. Dos azules significan lectura confirmada por la infraestructura existente; hover/title muestra los nombres. No se inventa una confirmación de entrega al sistema operativo del destinatario.
- Reacciones expresivas con emoji del sistema: celebración, enterado, yo me encargo, wow, sorpresa, risa y corazón. Identificadores y reacciones históricas se conservan. Sin ilustraciones SVG antiguas de emoji.
- Composer: +, texto, galería y micrófono blanco; con contenido cambia a enviar. Menú +: fotos, documentos, cámara, ubicación, ticket, tarea, contacto y recordatorio. Ubicación/contacto dicen Pronto; las demás opciones conectan a funciones existentes. Cámara usa captura del navegador; galería usa picker nativo.
- Tocar espacio vacío quita foco del texto. El sistema operativo controla el cierre/animación del teclado. Audio inicia con un clic y muestra onda, contador, descartar, pausa/continuar en rojo y enviar. El tiempo pausado se excluye.
- Cuenta: nombre/color existentes y foto de perfil nueva, accesible desde el avatar de Inicio o menú. Fotos privadas de hasta 10 MB antes de reducir a JPEG de 512 px; bucket de 5 MB. Solo el dueño puede subir/borrar en su carpeta y actualizar su perfil. Miembros activos pueden ver las fotos del equipo.

## Servidor

Migración aplicada en DesignToGoCRM: `20261001103101_chat_inbox_profiles.sql`. Agrega `profiles.avatar_storage_path`, restricción de carpeta propia, bucket privado `profile-avatars` y RLS por dueño/miembro activo; amplía reacciones con laugh/love sin cambiar las antiguas. No cambia el transporte push ni sus filtros/horarios.

## Verificación

- `CHAT-INBOX-QA.cjs`: app y handlers reales en Chromium con persistencia aislada. Navegación, chrome oculto, búsquedas, orden/previews, fotos de perfil y guardado dirigido al dueño, burbujas, hora/recibos, hover/long press, opciones Pronto, blur de teclado, controles de perfil, siete reacciones y proporción de fotos.
- `CHAT-AUDIO-QA.cjs`: Chromium MediaRecorder real con micrófono sintético servido desde localhost. Un clic inicia; onda/contador; pausa y reanudación; tiempo excluye pausa; envío persiste audio en DM; descartar no sube. Sin micrófono real ni datos externos.
- `CHAT-WHATSAPP-QA.cjs`, `TASKS-SIMPLE-QA.cjs`, `CHAT-COMPACT-QA.cjs`, `ASTRA-QA.cjs`: regresiones de adjuntos, fallos parciales, contexto, tareas, scroll de cuenta, reacciones, referencias, RLS/notificaciones previamente validadas.
- SQL en transacciones con rollback: subida propia de avatar, lectura por compañero activo, subida/metadata de otro dueño denegadas. Política DELETE inspeccionada; Supabase protege borrado directo de storage.objects, por lo que el borrado se hace únicamente vía Storage API.
- Advisors conservan deuda previa; la advertencia genérica de anonymous sign-ins incluye las políticas de avatar, pero todas exigen miembro activo y las escrituras además carpeta del auth.uid(). No existe acceso público al bucket.

Pendiente de integración futura: ubicación y contacto del teléfono. Validación de picker/cámara/teclado/permisos de micrófono en iOS/Android reales sigue siendo manual; Chromium valida lógica y MediaRecorder. Las fotos e identidad dependen de que cada miembro configure su perfil. Pruebas: `node CHAT-INBOX-QA.cjs`, `node CHAT-AUDIO-QA.cjs`; Playwright y CHROME_BIN opcional.
