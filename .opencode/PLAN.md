# PLAN — Goal Autónomo — Customer Zero (URL → Marketing → conversación)

## Fase 1 — Auditoría (paralela, antes de programar)
- [x] T0. Subagente Discovery/DNA: schema CompanyDNA, pipeline, gaps, repository.
- [x] T1. Subagente LLM/agent: MiniMax dead, LlmRouter existe, ningún tool llama al LLM,
  no hay chat. Ollama local funciona (OpenAI-compatible).
- [x] T2. Subagente Marketing/dept/backend/portal: tpl_marketing, DepartmentService,
  onboarding workflow, superficie actual, no hay chat.

## Fase 2 — Decisiones
- [x] T3. Provider real: OPENAI_BASE_URL → gateway local (Ollama). Bloqueo MiniMax demostrado.
- [x] T4. Contexto/Brain: reutilizar CompanyDiscoveryReport + DiscoveryReportRepository.
- [x] T5. Conversación: tool `marketing.chat` + runtime real como agent_marketing_director.

## Fase 3 — Implementación
- [x] T6. `packages/config`: OPENAI_BASE_URL opcional + OpenAIProviderConfig.baseUrl.
- [x] T7. `packages/llm-provider-openai`: client acepta baseURL.
- [x] T8. Verificación real: LlmRouter → Ollama (qwen3:0.6b y qwen3:1.7b) responde.
- [x] T9. `packages/tool-catalog`: `marketing.chat` (LLM-backed, contexto real, historial).
- [x] T10. `apps/backend`: web-analysis real (fetch + extracción + interpretación LLM).
- [x] T11. `apps/backend`: session composition persistente por organización.
- [x] T12. `apps/backend`: rutas analyze/correct/marketing(+prepare)/marketing/messages.
- [x] T13. `apps/backend/main.ts`: carga `.env` local (process.loadEnvFile).
- [x] T14. `apps/portal`: wizard URL-first (URL → working → review → correcciones →
  preparar → departamento → chat).

## Fase 4 — Tests (frontera nueva)
- [x] T15. tool-catalog: marketing.chat (3 tests: contexto real, historial, error).
- [x] T16. backend: web-analysis (5 tests), session composition (2 tests).
- [x] T17. portal: wizard (7 tests).

## Fase 5 — Validaciones
- [x] T18. `pnpm lint` / `typecheck` / `test` / `-r build` / `check` (33 paquetes, todo verde).

## Fase 6 — Validación real obligatoria (DoD)
- [x] T19. Backend real 3210 + portal real 5173 + Ollama 11434.
- [x] T20. Navegador real (headless Chrome CDP): URL → working → review → correcciones →
  preparar → departamento → mensaje → respuesta → segundo mensaje. **PASS** (Mailchimp).
- [x] T21. Segunda empresa real (Spotify) vía proxy del navegador: análisis real,
  Marketing activo, hechos específicos, continuidad. **PASS**.
- [x] T22. Métricas: gaps 22 → 15 (−7, críticos 13 → 7); preguntas 20 (cap).

## Fase 7 — Cierre
- [ ] T23. Informe final en WORKLOG.
- [ ] T24. Commits pequeños + push.
- [ ] T25. `.opencode/autopilot.done`. DETENER.
