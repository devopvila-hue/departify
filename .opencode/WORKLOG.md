# WORKLOG — Goal: Conectar Marketing y validar el flow end-to-end real

## Sesión (2026-08-07)

### HOTFIX dentro del sprint (corregido y validado primero)
1. **Idioma según locale de la UI**: el pipeline de discovery (business-discovery,
   congelado) genera preguntas en inglés. La UI es `lang="es"`. Se localizó en la
   frontera de presentación (`apps/backend/src/customer-zero/questions.ts`) sin
   tocar el paquete congelado.
2. **Preguntas obligatorias**: el flow ahora SÍ pregunta al CEO las preguntas
   derivadas de gaps reales (critical + high, una por categoría, solo categorías
   DNA persistibles, cap 8). Nuevo `GET /:org/questions` + `mandatoryQuestions`
   en analyze.
3. **Persistencia de respuestas**: nuevo `POST /:org/answers` fusiona las
   respuestas en el Company DNA con provenance `user_input` verificada
   (`answers.ts`), sustituyendo al antiguo `/correct` de 4 campos. El CEO prevalece
   sobre inferencias de la web.
4. **Transición correcta a Marketing**: el portal gana un paso de preguntas entre
   review y prepare; tras persistir respuestas pasa a prepare → Marketing.

Validado en API y navegador real (Spotify): preguntas en español, respuestas
reducen gaps, transición a Marketing correcta.

### Fases 4-7 — Marketing como Departamento (goal original)
- **tool-catalog**: nuevos tools `marketing.plan` y `marketing.execute`, ejecutados
  como `agent_marketing_director` por el runtime real, grounded en el Company DNA.
  - `marketing.plan`: interpreta el objetivo del CEO → plan estructurado
    (summary + items clasificados analysis/creation/external_action).
  - `marketing.execute`: produce el entregable real de un item ejecutable; nunca
    fabrica resultados.
- **backend**: sesión gana `marketingWork` (goal, summary, items con status).
  Rutas: `POST /:org/marketing/work` (goal→plan), `POST /:org/marketing/work/:itemId/execute`,
  `POST /:org/marketing/work/:itemId/approve` (gate), `GET /:org` (status para reload).
  Aprobación: items externos → `needs_approval` → CEO aprueba → `unavailable`
  con mensaje honesto "capacidad no conectada" (no simula).
- **portal**: vista Marketing con input de objetivo ("Necesito conseguir más
  clientes."), plan de Marketing, botones Ejecutar/Aprobar, estados (Pendiente,
  Completado, Necesita aprobación, Capacidad no conectada), y resume vía
  localStorage + `GET /:org` tras reload.

### Fricciones reales encontradas y corregidas
- **qwen3 es modelo de razonamiento**: emitía un "thinking" largo que consumía el
  presupuesto de salida → `content` vacío para generaciones largas. Solución
  mínima: directiva en el system prompt "responde directamente, sin razonar".
  Sin cambios en provider/router.
- **Tiempo del modelo local**: plan ~30-58s, execute ~22-90s. Se subió el timeout
  de `marketing.plan` a 120s y de `marketing.execute` a 180s, y se pidió
  entregables concisos.
- **JSON shape del modelo**: qwen3 devolvía `{ plan_de_trabajo: { etapas } }` en
  vez del `{ summary, items }` pedido. Parse tolerante en `parsePlanJson`.
- **Badges uppercase**: los tests de browser usaban matching case-sensitive; el
  CSS aplica `text-transform: uppercase`.

### Validaciones
- `pnpm lint` / `typecheck` / `test` / `-r build` / `check` → todo verde (33 paquetes).
- Navegador real (Spotify): URL → review → preguntas (es) → respuestas → preparar →
  objetivo → plan → ejecutar → completado → aprobar → unavailable → reload → persiste. **PASS**.
- Anti-hardcode: Mailchimp y Spotify producen entregables distintos y específicos
  de cada empresa (imposible intercambiarlos). **PASS**.

## Deuda detectada (NO implementada)
- FounderBrain sigue sin poblarse.
- Persistencia durable (Supabase) del session/DNA: in-memory (el reload del portal
  funciona; un reinicio del proceso pierde el estado).
- MiniMax heredado no operativo en `.env`.
- `marketing.execute` para items `creation`/`analysis` produce texto; las
  capacidades externas reales (publicar, enviar, gastar) no están conectadas →
  se reportan como `unavailable` de forma honesta.
- El `correct` antiguo se sustituyó por `/answers`; no hay migración de datos.
