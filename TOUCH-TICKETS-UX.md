# Chat táctil, fotos del Kanban y teléfonos

El chat admite tocar una foto para ampliarla, mantener pulsado un mensaje para abrir sus opciones y deslizarlo a la izquierda para responder. El mensaje acompaña el gesto y resalta al llegar al umbral. El desplazamiento vertical cancela las acciones; soltar una pulsación larga no abre accidentalmente la foto. Los controles del menú siguen funcionando inmediatamente después de mantener pulsado.

El Kanban reúne las imágenes de la bitácora histórica, del chat del ticket y de mensajes públicos vinculados al ticket. Excluye imágenes eliminadas, pendientes y conversaciones personales ajenas. Cada imagen conserva su bucket y se carga con una URL firmada autorizada. La foto más reciente aparece en un área de 160 px de alto y del ancho de la tarjeta, conservando la imagen completa. Tocar abre la galería. Las fotos procedentes de mensajes permiten volver al mensaje original; su eliminación se realiza desde ese mensaje, no desde el editor de bitácora.

Crear ticket ahora presenta el formulario con cliente, teléfono y trabajo, conservando la opción explícita de crear vacío. Se valida el teléfono antes de crear y se carga el ticket recién persistido antes de guardar sus datos asociados. La creación desde un mensaje también admite un teléfono. Elegir un cliente existente precarga su teléfono cuando el campo está vacío. El aviso Falta teléfono abre directamente su editor; funciona incluso en tickets históricos sin cliente vinculado. Los avisos y marcadores muestran icono y etiqueta, con superficies redondeadas y texto breve en los avisos.

## Validación

- `TOUCH-TICKETS-QA.cjs`: gestos, cancelación por scroll, respuesta desde el menú inmediatamente después de long press, ampliación de fotos, imágenes históricas y del chat, buckets, exclusión de eliminadas y privadas, foto central, teléfono al crear y desde un mensaje, avisos con/sin cliente y vistas de 320/768/1280 px.
- `CHAT-INBOX-QA.cjs`, `CHAT-WHATSAPP-QA.cjs`, `MOBILE-APP-QA.cjs`, `TASKS-SIMPLE-QA.cjs` y `DEVICE-ACCOUNTS-QA.cjs`: navegación, adjuntos, menús, siete vistas móviles, tareas y aislamiento de cuentas.

Pruebas en Chromium con datos y respuestas de persistencia simulados. No se realizaron escrituras de prueba en registros reales ni cambios de permisos de Storage. Queda comprobar sensaciones del gesto y teclado en un teléfono/tablet físico.
