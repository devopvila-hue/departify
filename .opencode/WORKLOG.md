# WORKLOG — Sprint 28A — Business Discovery Stabilization

## Sesión 1 (2026-08-06) — Diagnóstico completo

### Causas raíz (RC)
- **RC1** — `gap-analysis.ts:20`: `export type { GapAnalysisResult }` redundante antes de `export interface` → TS2484 (build).
- **RC2** — `discovery-types.ts:166`: `requestedAt` solo valida tipo (Date|string), no validez; `"invalid-date"` pasa → test "invalid requestedAt" falla.
- **RC3** — `gap-analysis.ts`: categorías de Founder Brain SIEMPRE analizadas aunque no haya brain → `analyzeGaps(dna)` == `analyzeGaps(dna,brain)` (22=22) y 4 critical gaps de brain se cuelan sin brain. Falla "include Founder Brain gaps" y "return empty for non-existent importance".
- **RC4** — filtrado por importancia: el código de `getGapsByImportance` es correcto; el fallo es síntoma de RC3.
- **RC5** — `discovery-service.ts:61`: `validateBusinessDiscoveryRequest` se llama FUERA del try/catch → error de validación rechaza la promesa en vez de devolver resultado `failed` tipado.
- **RC6** — Tests mutan objetos `readonly` (TS2540) y usan indexación no segura (TS2532). El contrato del dominio es inmutable (convención del repo, igual que departments/workflows). Alinear tests al contrato con builders por spread (patrón ya usado en company-dna.test.ts `createTestDna`).
- **RC7** — imports/params muertos: `_source` (company-dna, founder-brain), `_input` y `failedPhases` (pipeline), `DiscoveryQuestion` (gap-analysis), `FounderBrain` (test), `buildDiscoveryPartial`+eslint-disable (pipeline).
- **RC8** — e2e "reduce questions": el cap por defecto `maxTotalQuestions:20` enmascara la reducción (14 gaps y 12 gaps → ambos 20). Levantar el cap en el test para observar la propiedad real de reducción.

## Sesión 2 (2026-08-06) — Correcciones

- [x] T3. RC1: eliminar re-export `GapAnalysisResult` + import muerto `DiscoveryQuestion`.
- [x] T4. RC2: validar validez real de `requestedAt`.
- [x] T5. RC3: brain categories solo se analizan si se provee FounderBrain.
- [x] T7. RC5: envolver validación en try/catch → resultado `failed` tipado.
- [x] T8-T9. RC6/RC8: reescribir fixtures de tests con builders inmutables.
- [x] T10-T11. RC7: limpiar imports/params/variables muertos.
- [x] T12-T16. Validaciones finales (lint/typecheck/test/build/check en verde).
- [x] T17. Commit + push.
- [x] T18. Informe final + autopilot.done.
