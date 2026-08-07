# WORKLOG — Sprint 56 — Customer Zero Vertical Slice (MOON → Marketing → resultado visible)

## Sesión (2026-08-07)

### Bloqueo real encontrado
"El motor Customer Zero existe pero no puede invocarse desde el producto."
- Portal solo tenía `FoundationRoute`; backend solo rutas técnicas.
- Además: `rawData` (información real de MOON, Sprint 55) NO llegaba a discovery
  desde el flujo real: `ExecutiveDiscoveryWorkflowInput` no lo llevaba y
  `runProvisioningPipeline` no lo propagaba desde el payload del evento.

### Solución mínima aplicada (Opción A)
- `packages/executive-orchestrator/src/workflows/executive-discovery-workflow.ts`:
  `rawData?` en el input del workflow, propagado a `initiateDiscovery`.
- `packages/business-events/src/catalog/business-event-catalog.ts`:
  `runProvisioningPipeline` propaga `event.payload.rawData` → `discoveryWorkflow.run`.
- `apps/backend/src/customer-zero/customer-zero-composition.ts`:
  composición del host que reutiliza el pipeline (mismo wiring que el smoke test
  validado): report repo in-memory, tool catalog, tool runtime, bridge,
  orchestrator, discovery workflow, workflow executor, provisioning real
  `tpl_marketing`, catalog canónico, `BusinessEventService`.
- `apps/backend/src/server/routes/customer-zero.ts`:
  `POST /api/customer-zero/marketing` (único endpoint de intención de producto).
- `apps/portal/src/routes/CustomerZeroRoute.tsx`:
  formulario MOON → "Poner Marketing a trabajar" → estado → primer resultado.
  Router + proxy dev `/api` → backend.

### Archivos/paquetes modificados
- `apps/backend/src/customer-zero/customer-zero-composition.ts` (nuevo)
- `apps/backend/src/server/routes/customer-zero.ts` (nuevo)
- `apps/backend/src/server/server.ts`
- `apps/backend/package.json`, `pnpm-lock.yaml`
- `apps/backend/test/customer-zero.test.ts` (nuevo)
- `apps/portal/src/routes/CustomerZeroRoute.tsx` (nuevo)
- `apps/portal/src/routes/CustomerZeroRoute.test.tsx` (nuevo)
- `apps/portal/src/app/router.tsx`, `apps/portal/src/app/App.test.tsx`
- `apps/portal/src/styles/tokens.css`, `apps/portal/vite.config.ts`
- `packages/executive-orchestrator/src/workflows/executive-discovery-workflow.ts`
- `packages/executive-orchestrator/test/unit/executive-discovery-workflow.test.ts`
- `packages/business-events/src/catalog/business-event-catalog.ts`
- `packages/business-events/test/integration/business-events-end-to-end.test.ts`

### Paquetes deliberadamente intactos
- business-discovery (congelado), ROSA (congelado), workflows, departments,
  platform-composition, provisioning-engine, tool-catalog, tool-runtime,
  agent-tool-bridge, executive-director: sin cambios de lógica (solo contratos
  públicos estrictamente necesarios en executive-orchestrator).

### Tests (nueva frontera)
- Backend (4): input válido → resultado; reutiliza composición (departamento
  real); sin rawData → completo; sin companyName → 400.
- Portal (6): formulario, estado de carga, envío + resultado, error 500, error pipeline.
- Thread rawData: unit workflow (forwards rawData) + e2e payment.confirmed.

## Validaciones
- [x] `pnpm lint` — exit 0
- [x] `pnpm typecheck` — exit 0
- [x] `pnpm test` — exit 0 (todos los paquetes)
- [x] `pnpm -r build` — exit 0
- [x] `pnpm check` — exit 0 (33 paquetes Done)

## PRUEBA MANUAL REAL (DoD)
- Backend real en local: `http://127.0.0.1:3210` (dev server previo, hot-reload).
- Portal real en local: `http://127.0.0.1:5173` (vite reiniciado con proxy).
- Validación en navegador real (headless Chrome vía CDP):
  1. Formulario MOON renderizado ✓
  2. Información real introducida ✓
  3. "Poner Marketing a trabajar" clickado ✓
  4. Resultado visible: "Primer resultado de Marketing" con confianza low,
     gapCount 21, criticalGapCount 12, blockingGapCount 12, questionCount 20 ✓
  5. Mensaje: "Marketing ya conoce MOON Shared Living y ha producido su
     primer resultado." ✓
- `BROWSER_VALIDATION_RESULT: PASS`

### Input utilizado (sin secretos)
```json
{ "companyName": "MOON Shared Living", "rawData": { ...misión, visión, mercado, posicionamiento, productos, cliente ideal, tono... } }
```
### Output obtenido (con datos reales completos)
```json
{ "status": "completed", "department": "Marketing",
  "firstResult": { "confidence": "low", "gapCount": 15,
    "criticalGapCount": 7, "blockingGapCount": 7, "questionCount": 20 } }
```
(Con `rawData: {}` → gapCount 22 / critical 13: la información real de MOON
reduce los gaps, confirmando que el pipeline aprende el negocio.)

### Fricciones observadas
- Dev servers previos ya estaban levantados; hubo que reiniciar vite para el proxy.
- No hay Playwright/puppeteer instalado: validación con Chrome headless vía CDP.

## Estado
VALIDADO POR TESTS y VALIDADO MANUALMENTE EN NAVEGADOR (ambos verdes).
Sprint 56 candidato a cierre.
