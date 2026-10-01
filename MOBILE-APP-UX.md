# 20 mejoras de UI/UX móvil — DTGCRM

Fecha: 1 de octubre de 2026. Alcance: interfaz del CRM fuera de la pantalla dedicada de Chats. Se conserva el modelo de datos, permisos, acciones y cálculos existentes. No requiere migraciones ni cambios en funciones de servidor.

## Cambios implementados

1. **Una sola cabecera:** el título de la pantalla reemplaza la marca repetida en la barra móvil. Tickets muestran su folio y la ficha de cliente conserva su botón de regreso.
2. **Controles que se pueden tocar:** botones de navegación y acciones tienen al menos 44 px de alto; iconos importantes tienen también 44 px de ancho.
3. **Campos legibles:** inputs, selects y áreas de texto usan 16 px en móvil, para evitar el zoom automático de iOS al editar campos pequeños.
4. **Modales dentro de la pantalla:** formularios se limitan al alto disponible con unidades dinámicas, margen exterior y desplazamiento interno. Los campos de tarea y documento se organizan en una columna.
5. **Guardar al alcance:** los pies de los formularios de tarea y documento permanecen accesibles al desplazarse y respetan el área segura inferior.
6. **Filtros de tareas bajo demanda:** búsqueda siempre disponible; responsable, tipo, urgencia y estado se despliegan en «Filtros de tareas». Un contador indica cuántos filtros están aplicados.
7. **TV fuera del flujo diario:** las tres pantallas del taller quedan en un desplegable, mientras «+ Tarea» permanece visible.
8. **Tableros móviles navegables:** estados y responsables se muestran en pestañas desplazables, sin múltiples filas. Al entrar se muestra la primera columna con trabajo; las actualizaciones conservan la columna y el scroll elegidos.
9. **Vista de tickets en un control:** Miniaturas, Iconos, Lista, Detalles y Responsables pasan a un selector en lugar de cinco botones permanentes.
10. **Tablas utilizables en móvil:** desplazamiento horizontal contenido dentro de la tabla, indicación visual para deslizar y región accesible con teclado.
11. **Cabecera de ticket más limpia:** fechas, responsable, marcadores, documentos y estado se despliegan en «Fechas, documentos y estado». Cliente y «Qué sigue» continúan visibles.
12. **Acciones poco frecuentes agrupadas:** fijar y copiar resumen quedan dentro de «Más acciones». Entregar y cerrar siguen disponibles en el panel de estado, con sus confirmaciones existentes.
13. **Nombres largos que caben:** nombre y empresa se organizan sin desbordar la cabecera del ticket. Edición y contacto mantienen áreas de toque cómodas.
14. **Personalización de cliente sin ruido:** colores y estilos se despliegan desde «Personalizar cliente». Los colores tienen blancos de toque circulares de 44 × 44 px.
15. **Historia de cliente simplificada:** un selector reemplaza la fila de filtros de historia; usa los mismos filtros y eventos existentes.
16. **Filtros de biblioteca plegables:** cliente, autor y fecha se muestran al abrir «Filtrar fotos», con indicador de filtros aplicados. Buscar y Logos permanecen disponibles.
17. **Galería consistente:** cuadrícula de tres columnas y miniaturas cuadradas, con separación y esquinas uniformes.
18. **Calendario con menos filas:** periodo, navegación y «Programar» se mantienen visibles; vista, tipos de fecha, Míos, filtros y Sin fecha quedan en «Opciones». El resumen muestra vista y filtros activos.
19. **Cobranza centrada en cobrar:** saldo total primero; el desglose por antigüedad se despliega al pedirlo. «Registrar pago» ocupa una fila completa en cada tarjeta.
20. **Informes explorables:** periodo en un selector, indicadores generales visibles y secciones de detalle plegables por tema. Rango personalizado y tablas siguen disponibles.

Los desplegables recuerdan su estado durante la sesión, por pantalla o ticket. Cambiar un filtro o recibir un render no los cierra. También se conserva el scroll vertical en listas de clientes, biblioteca, calendario, informes, cobranza y tableros al actualizar la misma pantalla. El escritorio conserva sus controles completos; cambiar el tamaño de la ventana no deja contenidos inaccesibles.

## Validación

- `MOBILE-APP-QA.cjs`: Chromium con el render real de la app y datos aislados. Siete vistas a 320, 390 y 768 px; ausencia de desbordamiento horizontal de página y controles visibles de al menos 44 px de alto.
- Acciones reales de filtros de tareas, biblioteca y calendario; selectores de vistas, periodo e historia; apertura de personalización y cobranza; formulario de tarea y creación desde Kanban; edición de «Qué sigue»; conservación de filtros abiertos y scroll.
- Miniaturas cuadradas y colores de 44 × 44 px a 320 px. Formulario de tarea e invoice en una ventana de 320 × 480 px, botón final accesible, borrador conservado y paso a vista previa de invoice.
- Escritorio a 1280 px y cambio de móvil a escritorio con secciones inicialmente cerradas.
- `CHAT-INBOX-QA.cjs` y `TASKS-SIMPLE-QA.cjs`: regresiones de Chats, perfil, adjuntos, reacciones, audio, creación y guardado de tareas, recuperación ante fallo y menú de cuenta sin salto de scroll.

Las pruebas de esta ronda no envían datos a producción. Las capturas usan nombres y registros de prueba. Falta la comprobación manual en teléfonos físicos de Safari/Chrome, especialmente con su teclado real; la ventana de baja altura comprueba distribución, no sustituye esa prueba.

## Ejecución

Requiere Node, Playwright y Chromium/Chrome. Desde la raíz del repositorio:

```text
node MOBILE-APP-QA.cjs
node CHAT-INBOX-QA.cjs
node TASKS-SIMPLE-QA.cjs
```

`CHROME_BIN` permite elegir el ejecutable del navegador. `MOBILE-APP-QA.cjs` utiliza la fixture de `CHAT-INBOX-QA.cjs`, incluida en el repositorio. Revertir el commit de esta ronda restaura la interfaz anterior y no modifica datos del servidor.
