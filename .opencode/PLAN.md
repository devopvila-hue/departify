# PLAN — Goal Autónomo — Post-OAuth Gmail Operational Recovery + Central Chat Reality

## Fase 0 — Recuperación del estado (auditoría, SIN modificar nada)
- [ ] T0. Lectura del working tree: git status/diff completo, archivos modificados, migración nueva.
- [ ] T1. Leer arquitectura: rosa.yaml, docs/architecture.md, ADR 0006, CZ01–CZ04.
- [ ] T2. Leer código tocado por el agente anterior (gmail-adapter, credential-resolver,
      google-tokens, customer-zero-v2, chat-response-enrichment, main.ts).
- [ ] T3. Determinar A completado / B parcial / C faltante / D roto / E migraciones /
      F tests incompletos / G desacuerdo código-tests → RECOVERY CHECKPOINT.

## Fase 1 — Post-OAuth truth (P0-1..P0-6)
- [ ] T4. Trazar path OAuth: callback portal → backend → state → exchange → scopes →
      refresh → persistencia → connection → UI → chat → Gmail adapter → Gmail API.
- [ ] T5. P0-2: verificar/finalizar persistencia durable de tokens (Supabase, org+user+provider).
- [ ] T6. P0-3: refresh token reconnect preserva token existente.
- [ ] T7. P0-4: granted scopes → capacidades existentes (mapping exacto).
- [ ] T8. P0-5: probe operacional Gmail real tras OAuth (readonly, no enviar).
- [ ] T9. P0-6: una única fuente de verdad de conexión (Connections + Central Chat).

## Fase 2 — Central Chat reality (P0-7..P0-10)
- [ ] T10. P0-7: "¿Tengo algún correo importante?" → ruta real → Gmail → respuesta grounded.
- [ ] T11. P0-8: "hola" → respuesta conversacional real (no solo workflow cards).
- [ ] T12. P0-9: eliminar proactividad fake repetitiva (Elvira-ready) — trigger honesto.
- [ ] T13. P0-10: auditar Sessions V1 sin rediseñar; sin regresiones.

## Fase 3 — Tests (A–Z del goal)
- [ ] T14. Tests post-OAuth + granted scopes + chat reality (completar los del agente anterior).
- [ ] T15. Verificar tests existentes de 5-session/compaction siguen verdes.

## Fase 4 — Quality gates
- [ ] T16. `pnpm -r lint`
- [ ] T17. `pnpm -r typecheck`
- [ ] T18. Tests targeted primero, luego suite normal.
- [ ] T19. `pnpm -r build`
- [ ] T20. `pnpm check`

## Fase 5 — Git + producción
- [ ] T21. Commit único coherente del trabajo pendiente (sin squash de histórico).
- [ ] T22. Push si gates verdes y branch/upstream correctos (sin force push).
- [ ] T23. Verificar deploy Railway si aplica (health endpoint), sin tocar variables ni
      Google Cloud sin evidencia de runtime.

## Fase 6 — Cierre
- [ ] T24. Informe final (33 puntos) en WORKLOG con FINAL STATUS.
- [ ] T25. `.opencode/autopilot.done` SOLO si todo verificado (y sin validación real de
      Gmail → FINAL STATUS = READY FOR FOUNDER HUMAN VALIDATION, no PASS).
