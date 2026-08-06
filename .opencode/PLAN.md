# PLAN — Sprint 28A — Business Discovery Stabilization

## Fase 1 — Diagnóstico de causas raíz
- [ ] T1. Recopilar todos los errores de `lint`, `typecheck`, `test` y `build` de `packages/business-discovery`.
- [ ] T2. Agrupar errores por causa raíz (export conflict, readonly contract, validación, gap analysis logic, service error handling, unused imports).

## Fase 2 — Corrección de causas raíz (dominio)
- [ ] T3. Corregir conflicto de export de `GapAnalysisResult` en `src/analysis/gap-analysis.ts`.
- [ ] T4. Corregir validación de `requestedAt` en `src/contracts/discovery-types.ts`.
- [ ] T5. Corregir integración de `FounderBrain` dentro de `GapAnalysis`.
- [ ] T6. Corregir filtrado correcto por importancia (`getGapsByImportance`).
- [ ] T7. Corregir manejo de errores del Discovery Service.

## Fase 3 — Alineación dominio ↔ tests
- [ ] T8. Revisar los 95 errores TS2540/TS2532 de los tests: decidir si es contrato cambiado (justificar) o test desalineado (corregir test contra la API real).
- [ ] T9. Revisar los 7 tests de comportamiento que fallan y alinearlos al dominio corregido.

## Fase 4 — Limpieza
- [ ] T10. Eliminar imports sin usar (6 errores lint + `eslint-disable` de pipeline).
- [ ] T11. Eliminar variables/código muerto.

## Fase 5 — Validaciones
- [ ] T12. `pnpm lint` verde.
- [ ] T13. `pnpm typecheck` verde.
- [ ] T14. `pnpm test` verde.
- [ ] T15. `pnpm build` verde.
- [ ] T16. `pnpm check` verde.
- [ ] T17. Commit + push a main.
- [ ] T18. Informe final y `.opencode/autopilot.done`.
