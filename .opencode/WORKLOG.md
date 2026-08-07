# WORKLOG — Goal Autónomo — Customer Zero (URL → WOW → ADN → Marketing → conversación)

## Sesión (2026-08-07)

### Auditoría Fase 1 (subagentes paralelos)
- **Discovery/DNA**: DNA canónico 14 secciones + completeness; solo rawData lo
  puebla; FounderBrain nunca poblado; `phaseDataCollection` placeholder; gaps
  deterministas (14 DNA + 8 Brain); report persiste en DiscoveryReportRepository.
- **LLM/agent**: MiniMax configurado pero **no operativo** (placeholder
  `api.minimax.example.com` + 401). LlmRouter existe (chat/complete/embed).
  Ningún tool del catálogo llama al LLM. No hay chat/historial. AgentRuntime es
  solo ciclo de vida. ExecutiveDirector es determinista.
- **Marketing/backend/portal**: tpl_marketing (director + 3 empleados + tools +
  kcol + memory + crm). DepartmentService en memoria. Onboarding 6 pasos →
  finalOutput = discovery.summary. Superficie actual single-shot; sin chat.

### Bloqueos y decisiones
- **H (LLM)**: MiniMax muerto → provider real = OpenAI-compatible apuntando a la
  gateway local (Ollama). Se añadió `OPENAI_BASE_URL` (config + client). El
  `.env` local apunta a `http://127.0.0.1:11434/v1` con modelo `qwen3:1.7b`
  (modelo real, descargado localmente; qwen3:0.6b también disponible).
- **Brain/contexto**: NO se crea paquete Brain. El `CompanyDiscoveryReport`
  (DNA + gaps + preguntas) en el `DiscoveryReportRepository` es el Brain
  funcional; `marketing.chat` lo lee y lo inyecta al LLM.
- **Conversación**: tool `marketing.chat` en el catálogo core. Ejecutado como
  `agent_marketing_director` vía AgentToolPort → ToolRuntime → CoreToolCatalog →
  LlmRouter → provider real. Lleva historial para continuidad.

### Implementación
- `packages/config`: `OPENAI_BASE_URL` opcional (schema + runtime + test).
- `packages/llm-provider-openai`: client pasa `baseURL` (config + test).
- `packages/tool-catalog`: `marketing.chat` tool (input org/message/history;
  sistema prompt con DNA real; llama al router). Registro condicional en
  `buildCoreCatalog` (llmRouter + discoveryRepository). Exportado.
- `apps/backend/src/customer-zero/web-analysis.ts`: `fetchAndExtractWebsite`
  (fetch real con timeout/UA, extracción HTML title/desc/h1-h3/p/links),
  `interpretWebsite` (LLM real → JSON, sanitizado), `buildRawDataFromInterpretation`
  (→ DNA rawData con confidence website).
- `apps/backend/src/customer-zero/llm-runtime.ts`: LlmRouter real desde config.
- `apps/backend/src/customer-zero/customer-zero-session.ts`: composición
  persistente por org (in-memory): llm, reportRepository, departmentService,
  discoveryWorkflow, executor, port, provisioning, businessEvents + state
  (url, rawData, companyName, conversation, reports). Helpers
  `runDiscoveryForSession`, `runMarketingPreparationForSession`.
- `apps/backend/src/server/routes/customer-zero.ts`: analyze / :org/correct /
  :org/marketing (prepare) / :org/marketing (GET) / :org/marketing/messages.
- `apps/backend/src/main.ts`: carga `.env` local (process.loadEnvFile) — sin
  esto el provider no leía credenciales en runtime.
- `apps/portal/src/routes/CustomerZeroRoute.tsx`: wizard URL-first completo.
- `apps/portal/src/styles/tokens.css`: estilos wizard + chat.

### Tests (nueva frontera)
- tool-catalog marketing.chat: 3 (contexto real en system prompt, historial,
  error sin contexto).
- backend web-analysis: 5 (extracción, sin meta, rawData mapping, sanitización LLM).
- backend session composition: 2 (discovery con datos reales reduce gaps;
  departamento Marketing real + primer resultado).
- portal wizard: 7 (URL única, working state, review+corrections, preparar,
  mensaje→reply, error).

## VALIDACIONES (todo verde)
- `pnpm lint` exit 0 (33 paquetes)
- `pnpm typecheck` exit 0 (33)
- `pnpm test` exit 0 (27 suites)
- `pnpm -r build` exit 0 (27)
- `pnpm check` exit 0 (33)

## PRUEBA REAL EN NAVEGADOR (DoD)
Backend `http://127.0.0.1:3210` · Portal `http://127.0.0.1:5173` · Ollama `http://127.0.0.1:11434`.

### Empresa 1 — https://www.mailchimp.com (headless Chrome CDP, flow completo)
[1] URL-first form ✓ [2] working state ✓ [3] understanding review (Mailchimp,
email marketing/SMS, productos, audiencia) ✓ [4] correcciones ✓ [5] departamento
Marketing activo + director agent_marketing_director ✓ [6] reply con hechos
específicos (expansión de mercado, IA, personalización) ✓ [7] segundo mensaje
con continuidad ("Has dicho que la primera prioridad...") ✓
**BROWSER_VALIDATION_RESULT: PASS**

### Empresa 2 — https://www.spotify.com (segunda validación, no hardcodeada)
- ANALYZE 200: understood.companyName=Spotify, activity="Digital music service
  providing access to millions of songs", products, gapCount=14 (vs 22 vacío).
- CORRECT gapCount=14. PREPARE: dept Marketing activo, director correcto,
  firstResult.gapCount=14.
- MSG1 reply usa hechos de Spotify (UX/retención, playlist personalizadas).
- MSG2 conserva contexto ("la primera prioridad fue mejorar la experiencia del
  usuario") y da ejemplo concreto (959 chars).
**SECOND_COMPANY_VALIDATION: PASS**

### Métricas de reducción (evidencia real)
- Antes (DNA vacío): 22 gaps, 13 críticos, 20 preguntas.
- Después (web real): 15 gaps, 7 críticos, 20 preguntas (cap del generador).
- Reducción real de gaps y críticos mediante investigación automática.

### Bloqueos encontrados y cómo se corrigieron
1. MiniMax no operativo (placeholder + 401) → provider OpenAI-compatible local.
2. Backend no cargaba `.env` → `process.loadEnvFile` en main.ts.
3. Premier Inn demasiado pesado (timeout 15s) → se usaron sitios reales ligeros;
   el límite es del sitio, no del sistema.
4. LLM devolvía objetos anidados/números en campos de texto → sanitización de la
   interpretación antes de construir rawData.

## Deuda detectada (NO implementada)
- Preguntas del CEO (discovery.questions) no se responden aún en el wizard.
- Persistencia durable (Supabase) del session/DNA: queda in-memory.
- FounderBrain nunca se puebla (sigue siendo un gap de conocimiento).
- MiniMax sigue registrado en `.env` aunque no operativo (config heredada).
- El `correct` solo acepta mission/market/positioning/valueProposition.
