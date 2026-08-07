# GOAL AUTÓNOMO — CUSTOMER ZERO — URL → WOW → ADN → CONTEXTO → MARKETING → CONVERSACIÓN REAL

## Estado de partida (Sprint 56, commit 0261709)
Vertical slice validado: Portal → POST /api/customer-zero/marketing → pipeline
existente → rawData → discovery → provisioning → Marketing → primer resultado.
rawData llega a discovery; el contexto reduce gaps. NO estaba demostrado:
descubrir la empresa por sí mismo, DNA suficiente, contexto → Marketing,
conversación real, comportamiento de Departamento.

## Objetivo (resultado de producto verificable)
URL → investigar REALMENTE → "esto hemos entendido" → confirmar/corregir →
gaps/preguntas imprescindibles → Company DNA real → contexto disponible →
Marketing preparado → conversación contextualizada con hechos reales.

## Bloqueos reales encontrados (auditoría Fase 1)
- **A. No existe capacidad de análisis web real** (sin HTTP client, sin scraper;
  `phaseDataCollection` es placeholder).
- **G. No existe ninguna vía de conversación** (no chat, no historial, no endpoint).
- **H. MiniMax NO es operativo**: `MINIMAX_BASE_URL` = `https://api.minimax.example.com/v1`
  (dominio reservado, DNS falla) y la API key devuelve 401. **Bloqueo demostrado.**
- **E. El contexto empresarial llega a agentes solo vía `discovery.get`** leyendo
  el DiscoveryReportRepository; no había conversación que lo usara.

## Decisiones (mínimo real, sin nueva arquitectura)
- **Provider LLM real**: el bloqueo de MiniMax está demostrado → se reutiliza el
  provider OpenAI (OpenAI-compatible) con `OPENAI_BASE_URL` apuntando a la
  gateway local (Ollama, `qwen3:1.7b`). Sin paquete nuevo, sin clave externa.
- **Web analysis real**: `fetch` de Node + extracción HTML + interpretación LLM
  real → `rawData` (DNA shape). Sin fixtures.
- **Conversación real**: nuevo tool `marketing.chat` en el catálogo core que lee
  el DiscoveryReportRepository (contexto real) y llama al LLM Router real,
  ejecutado como `agent_marketing_director` a través del runtime real.
- **Contexto/Brain**: NO se crea paquete Brain. Se reutiliza el
  `CompanyDiscoveryReport` (DNA + gaps + preguntas) persistido en el
  `DiscoveryReportRepository` — ese es el Brain funcional.
- **Session**: composición persistente por organización (in-memory) para que el
  contexto sobreviva entre pasos del flujo.

## Regla de producto congelada
El onboarding empieza con "¿Cuál es la web de tu empresa?", no "Cuéntanos tu
empresa". Departify trabaja; el CEO decide.

## Fuera de alcance
NO IA nueva por impulso (la conversación usa el runtime real), NO Stripe, NO
auth, NO Supabase nueva, NO Kanban, NO scheduler, NO nuevos Departamentos,
NO refactors masivos, NO "ya que estamos". Business Discovery congelado. ROSA congelado.
