# GOAL — SPRINT 56 — CUSTOMER ZERO VERTICAL SLICE — MOON → MARKETING → RESULTADO VISIBLE

## Estado (descubierto mediante uso real)
- `pnpm check` → verde. Backend levanta. `GET /health` → 200. Portal levanta.
- Portal solo contenía `FoundationRoute`; backend solo rutas técnicas.
- El pipeline Customer Zero existe y está validado por tests, pero NO existe
  superficie HTTP + UI para que el CEO lo use.

## Objetivo único
Crear la REBANADA VERTICAL MÍNIMA para ejecutar desde el navegador:
MOON → información real → contratar Marketing → pipeline existente → primer resultado → CEO.

## Bloqueo real encontrado (auditoría)
"El motor Customer Zero existe pero no puede invocarse desde el producto."
Además: `rawData` (Sprint 55) no llegaba a discovery desde el flujo real
(`ExecutiveDiscoveryWorkflowInput` no lo llevaba; `runProvisioningPipeline`
no lo propagaba desde el payload del evento).

## Decisión (Architecture Confidence Gate)
Opción A: UN endpoint HTTP de intención de producto + pantalla mínima,
reutilizando composición/pipeline existente. La ruta es ADAPTER/ENTRY POINT.
Cambio mínimo en el flujo: thread de `rawData` por los contratos públicos.

## Alcance
- `packages/executive-orchestrator`: `ExecutiveDiscoveryWorkflowInput.rawData?` → `initiateDiscovery`.
- `packages/business-events`: `runProvisioningPipeline` propaga `payload.rawData` → `discoveryWorkflow.run`.
- `apps/backend`: composición Customer Zero + `POST /api/customer-zero/marketing`.
- `apps/portal`: `CustomerZeroRoute` (formulario MOON + botón "Poner Marketing a trabajar" + estado + resultado).
- Tests: frontera nueva (endpoint, portal) + thread de rawData.

## Fuera de alcance
NO IA nueva, NO Stripe real, NO Supabase nueva, NO auth, NO dashboard,
NO scheduler, NO Kanban, NO refactors grandes, NO "ya que estamos".
Business Discovery congelado. ROSA congelado.
