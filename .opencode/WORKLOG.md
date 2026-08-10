# WORKLOG — Post-OAuth Gmail Operational Recovery + Central Chat Reality

## Sesión 1 (2026-08-10) — Recuperación + auditoría

### RECOVERY CHECKPOINT (estado del working tree heredado de Claude Code)

**completed (ya en working tree, sin commitear):**
- `google-tokens.ts` (nuevo): token store durable (InMemory + Supabase), refresh rotation,
  granted-scope parsing, `mergeTokenExchange` (preserva refresh token), probe operativo
  Gmail (`gmail.users.getProfile`), `completeGoogleOAuthCallback` (state → exchange →
  scopes → refresh → identity → probe → persist), `GMAIL_SCOPE_TO_CAPABILITY` mapping.
- Migración `supabase/migrations/20260810150000_google_oauth_tokens.sql` (tabla durable,
  RLS block-all, service_role).
- `main.ts`: cablea `SupabaseGoogleTokenStore` en boot (producción durable).
- `gmail-adapter.ts`: lee del store durable primero; refresh vía google-tokens; scopes granted.
- `credential-resolver.ts`: `resolveGoogleCredentials` async, `hasOperationalGoogleIdentity(ForOrg)`,
  `googleTokenSummaryFor`, guards provider mautic/resend.
- `customer-zero-v2.ts`: callback usa `completeGoogleOAuthCallback` y solo marca
  `connected` si probe OK + refresh token; dispatch email en `processCeoMessage`
  (`isEmailQuestion` → `runGmailRead` → `GmailAdapter.searchMessages`); eventos por turno
  = solo transcript + work states (sin `buildProactiveOpening` repetido);
  `buildCatalogConnectionViews` async leyendo el store durable.
- `chat-response-enrichment.ts`: `workStatesForTurn` → [] si no hay trabajo delegado
  (greeting ya no produce "Mensaje recibido"/"Listo").
- `department-work-executor.ts`/`mautic-tools.ts`/`email-delivery-adapter.ts`: guards
  de provider + fix `apiKey` Resend.
- Tests parcheados: mock del probe Gmail en oauth-routes + canonical-redirect; assert
  provider en credential-resolver.

**partial:**
- Tests A–Z del goal: NO escritos (solo 3 ficheros parcheados). Falta suite para
  google-tokens + chat reality.
- P0-9: la apertura `/command-center/opening` sigue emitiendo la tarjeta
  "Elvira ya está lista…" sin objetivo ni trabajo (fake proactivity en carga inicial).

**missing:**
- Suite de tests nueva (granted scopes, refresh preservation, mapping capacidades,
  aislamiento org, tokens fuera de APIs públicas, probe OK/fail → connected/no,
  "hola" → reply conversacional, sin tarjeta Elvira repetida, Gmail question → respuesta
  grounded, empty → honesto, unavailable → recovery).
- Quality gates completos del monorepo.
- Commit + push + verificación deploy.

**suspicious:**
- `isEmailQuestion` declarada async sin await (cosmético; lint OK).
- `completeGmailOAuth` legacy sigue vivo solo para tests antiguos (coexiste con el nuevo pipeline).
- `runGmailRead` elige la primera fila operacional del org (userId desconocido en el
  prototipo) — aceptable según el comentario del autor.

**next smallest action:** testear el estado actual es verde (backend 415/415, lint,
typecheck OK) y escribir la suite A–Z + arreglar la tarjeta Elvira-ready en el opening.

## Sesión 2 (2026-08-10) — EVIDENCIA REAL DE PRODUCCIÓN (nuevo brief del founder)

### Hallazgos de runtime (Railway + Supabase)
- Producción corre el commit **52ca47c** desde GitHub (deploy automático al push). El
  trabajo interrumpido (google-tokens, durable store, probe) NO está desplegado.
- **P0 A — OAuth state store en memoria**: `gmailOAuthStateStore` es un `Map` del
  proceso. En Railway (multi-instancia o reinicio entre connect y callback) el lookup
  del nonce falla → `invalid_state` 401 → portal muestra error → Gmail NO conectado →
  bucle. Coincide EXACTAMENTE con el síntoma del founder.
- **P0 B — la versión desplegada (52ca47c) guarda tokens SOLO en memoria**
  (`gmailTokenStore` Map), sin probe operativo, sin scopes granted, sin preservación
  de refresh token. El working tree lo arregla pero no está desplegado.
- **P0 C — migración NO aplicada**: `google_oauth_tokens` no existía en Supabase de
  producción (404). El pipeline nuevo habría petado en `put()` → 500 → bucle.
  **RESUELTO**: `supabase db push` aplicó 3 migraciones pendientes (inbox, compaction,
  google_oauth_tokens) → tablas verificadas (200).
- **Observado — 100% de peticiones HTTP recientes en 4xx**: spam de `work-feed` 401
  (~1.5s) → el tab del founder tiene un JWT de Supabase inválido/caducado. Un 401 en el
  POST del callback produce exactamente "vuelve → No conectado" sin explicación.
- `SUPABASE_JWKS_UR` en Railway está mal escrito (falta L) pero el código NO lo usa
  (auth vía `supabase.auth.getUser(token)`), así que es inerte.

### Decisiones de arreglo
1. **State store durable**: nueva tabla `oauth_state` + adaptador Supabase (mismo
   patrón que google-tokens), cableado en main.ts, fallback in-memory para tests.
2. Desplegar el pipeline interrumpido (durable tokens + probe + scopes + chat fixes).
3. Diagnósticos seguros por checkpoint en el callback.
4. Portal: mensaje de error claro si el callback falla (incl. hint de re-login en 401).
5. Tests A–Z + tests del state store durable (incl. simulación cross-instancia).

### Implementado en esta sesión
- `oauth-state.ts` (nuevo): state store durable (InMemory + Supabase), async
  interface, DI boundary (`setGoogleOAuthStateStore`/`getGoogleOAuthStateStore`),
  `gmailOAuthStateStore` exportado como fallback compartido (tests lo seedean).
- `20260810160000_oauth_state_durable.sql` (nuevo): tabla `oauth_state`, RLS block-all.
- `gmail-adapter.ts`: `startGmailOAuth` async → store durable; `completeGmailOAuth`
  lee/consume el store durable.
- `google-tokens.ts`: `validateOAuthState` async; `mergeTokenExchange` NO sobrescribe
  refresh token con "" (trata vacío como ausente); read-back write→reload con code
  `credential_persisted_but_not_readable`; checkpoints seguros
  (`onCheckpoint`) en todo el pipeline (state_valid, token_exchange_success/failed,
  granted_scopes, refresh_token_present, existing_refresh_token_present,
  credential_persisted, credential_reload_success, gmail_probe_success/failed,
  connection_marked_operational/not_operational).
- `customer-zero-v2.ts`: connect await startGmailOAuth; callback usa
  `getGoogleOAuthStateStore()` + `onCheckpoint` → request.log;
  `google_oauth_callback_complete` log al final; export test-reset del cache
  `googleOperationalCache`.
- `main.ts`: cablea `SupabaseOAuthStateStore` en boot.
- Portal `GoogleOAuthCallbackRoute.tsx`: mensajes por código de error del backend
  (invalid_state/replay/org/user → "expiró"; auth → "sesión caducada, vuelve a entrar";
  GOOGLE_OAUTH_NOT_CONFIGURED; credential_persisted_but_not_readable; default claro).
  NUNCA "no conectado" sin explicación.
- Tests: `customer-zero-05-post-oauth.test.ts` (27 tests A–Z): granted scopes,
  capability mapping, refresh preservation, org isolation, summaries sin tokens,
  state store durable contract (incl. Z2: instancia fresca → invalid_state honesto),
  N/O/P/Q/R/S/T/U/V/W/X/M.
- Fix flakiness: timeouts B1/B2 en context-readiness (import dinámico lento).

### Estado
- Backend: 442/442 tests verdes, lint OK, typecheck OK.
- Migraciones aplicadas a producción Supabase: inbox, compaction, google_oauth_tokens,
  oauth_state (verificadas con 200).
- PENDIENTE: gates del monorepo, commit, push, verificación de deploy, informe final.



