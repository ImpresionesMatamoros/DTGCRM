# DTG CRM — verificación STAGING

Fecha: 2026-10-02. Base productiva examinada: `d5b2354f1cd11a1968bdaf1ede066a85b00619f2`.

```text
STAGING CODE: READY
STAGING DATABASE: OWNER ACTION REQUIRED
STAGING DEPLOYMENT: OWNER ACTION REQUIRED
STEP 10 INTEGRATION TESTED IN STAGING: NO
PRODUCTION MODIFIED: NO
```

READY significa código integrado y tooling validado, listo para configuración/provisioning. No significa URL accesible ni DB ya creada.

## Pruebas ejecutadas en esta entrega

Node 24.19.0, pnpm 11.19.0, Chrome local; dependencias exactas y lockfile. Sin lectura de tablas ni ejecución SQL en producción, sin provisionar proyectos, sin publicar sitios ni secretos remotos.

| Suite | Resultado | Evidencia y límite |
|---|---|---|
| STAGING-QA.cjs | PASS | Config incompleta para antes de Auth; cinco refs existentes rechazados; origen separado; secret key rechazada; CSP/guard y enlaces externos bloqueados; banner móvil/PC; SW inerte; workflow sin main/Pages-write; proxy isolation |
| Provisioning dentro de STAGING-QA | PASS con CLI interceptada | Comandos llevan solo ref ficticio, secrets antes de deployment, dos stubs OFF; confirmación productiva rechazada. **No se desplegó ninguna función real** |
| PRODUCT-ENGINE-PROXY-QA.cjs | 9/9 PASS | Auth, allowlist, timeout, token privado, contrato, fallbacks |
| PRODUCT-ENGINE-QA.cjs | 20/20 PASS offline | Respuestas reales grabadas del paquete; schema SHA fijado; picker, snapshots, QUOTE_ONLY, manual, outage, repricing, detach y documentos. No es prueba del servicio remoto |
| TICKET-SEARCH-QA.cjs | PASS | Orden normal, posición cursor, edición intermedia, IME, filtro compartido móvil/PC y cache fotos por render |
| APP-STARTUP-QA.cjs | PASS | 21 lecturas solapadas, asociaciones preservadas, fallback opcional/error obligatorio; latencia simulada, no benchmark de teléfono real |
| MOBILE-APP-QA.cjs | PASS | 320/390/768 px y controles escritorio, siete vistas |
| CLIENTS-WORKSPACE-QA.cjs | PASS | Ranking, asociación/drag, flags, notas/tareas, merge, galería y 320/390/768/1280 px |
| CALENDAR-DETAILS-QA.cjs | PASS | Scroll por día, hover, fotos/chat, atrasadas/sin fecha, drag y tamaños móvil/PC |
| CHAT-INBOX-QA.cjs | PASS | Chat/inbox, touch/hover, fotos, reacciones, compositor y grabación |
| pnpm install --frozen-lockfile --ignore-scripts | PASS | Instalación reproducible; sin ejecutar install scripts |
| Sintaxis JS/scripts y conflictos merge | PASS | Sin marcadores de conflicto; inline scripts y scripts staging compilables |

El guard se probó con dominios reservados `.test`, refs sintéticos y rutas interceptadas en Playwright. La configuración de esos fixtures no se entrega como ambiente real. El mock SDK no accede a Supabase.

## STEP 10 remoto: pendiente

| Caso solicitado | Estado |
|---|---|
| Maestro $45, ventas $45/$40/$50 y snapshot fijo | Escenario documentado; NO ejecutado en staging remoto |
| Cambio posterior de maestro conserva ticket histórico | Lógica cubierta offline con datos grabados; NO ejecutado remoto |
| QUOTE_ONLY sin importe inventado y precio provisional | Picker/guard cubiertos offline; validación de DB y servicio remoto pendiente |
| PE caído permite manual y guardar ticket | Cubierto offline; corte del servicio staging real pendiente |
| Auth/RLS/Storage y precisión SQL en Supabase real | OWNER ACTION REQUIRED; scripts/QA SQL disponibles, no ejecutados |
| Funciones en Deno/Supabase real | OWNER ACTION REQUIRED; proxy probado como handler Node, no runtime remoto |
| Deploy workflow GitHub y hosting real | Preparado; job build/deploy apagado hasta configuración. Estado del primer run se documenta aparte si está disponible |

No se afirma que todos los tests históricos del CRM pasen: se ejecutaron las suites relevantes listadas. El paquete STEP 10 original reporta seis fallos heredados; no se usa esta tarea para corregir módulos no relacionados.

## Pendientes del propietario

1. Proyectos CRM y PE nuevos, refs/claves/tokens nuevos y decisiones de costos/región.
2. Baseline CRM completo de esquema sin filas ni secretos; revisar triggers, grants/RLS, Vault, cron, Auth hooks y webhooks antes de importar.
3. Hosting/origen CRM staging y servicio PE HTTPS separados; proteger administración PE y desactivar exposición pública de DB PE.
4. Buckets/políticas, Auth sin emails/SMS externos, usuario ficticio confirmado y catálogo comercial revisado.
5. GitHub Environment staging restringido a branch staging; configurar variables/secrets y activar build/deploy cuando sea seguro.
6. Ejecutar preflight/advisors/smoke y los casos remotos de aceptación. Sustituir NO por YES solo con evidencias reales.

## Producción

No cambios en `main`, Pages, DB, Storage, Auth, Edge Functions, secrets ni catálogo productivos. Solo inventario de proyectos y metadatos GitHub de lectura. Rama staging creada desde el HEAD vigente; no se copian registros del CRM real.
