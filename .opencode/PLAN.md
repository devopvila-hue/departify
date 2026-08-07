# PLAN — Sprint 56 — Customer Zero Vertical Slice (MOON → Marketing → resultado visible)

## Fase 1 — Auditoría (Architecture Completion Gate)
- [x] T0. Recorrer `apps/backend`, `apps/portal`, `platform-composition`,
  `business-events`, `departments`, `workflows` + contratos públicos necesarios.
- [x] T1. Confirmar cómo reutilizar el pipeline existente (smoke test Marketing Customer Zero).
- [x] T2. Detectar el bloqueo: sin superficie HTTP+UI y `rawData` no llega a
  discovery desde el flujo real.

## Fase 2 — Decisión (Architecture Confidence Gate)
- [x] T3. Opción A: UN endpoint HTTP + pantalla mínima. La ruta es adapter.

## Fase 3 — Implementación
- [x] T4. `executive-orchestrator`: `ExecutiveDiscoveryWorkflowInput.rawData?` → `initiateDiscovery`.
- [x] T5. `business-events`: `runProvisioningPipeline` propaga `payload.rawData`.
- [x] T6. `apps/backend`: composición Customer Zero + ruta `POST /api/customer-zero/marketing`.
- [x] T7. `apps/portal`: `CustomerZeroRoute` (formulario + estado + resultado), router, proxy dev.

## Fase 4 — Tests (solo frontera nueva)
- [x] T8. Backend: input válido → resultado; sin rawData → completo; sin companyName → 400.
- [x] T9. Portal: formulario, ejecución, estado de carga, resultado, error.
- [x] T10. Thread de rawData: unit workflow + e2e payment.confirmed.

## Fase 5 — Validación monorepo
- [x] T11. `pnpm lint`
- [x] T12. `pnpm typecheck`
- [x] T13. `pnpm test`
- [x] T14. `pnpm -r build`
- [x] T15. `pnpm check`

## Fase 6 — Validación manual obligatoria (DoD)
- [x] T16. Backend real en local (3210). Portal real en local (5173).
- [x] T17. Navegador: MOON → información real → "Poner Marketing a trabajar" → resultado visible.
- [x] T18. Headless Chrome CDP: PASS.

## Fase 7 — Cierre
- [ ] T19. Informe final en WORKLOG.
- [ ] T20. Commit + push.
- [ ] T21. `.opencode/autopilot.done`. No iniciar Sprint 57.
