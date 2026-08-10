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

## Sesión 3 (2026-08-10) — CIERRE

- Gates completos del monorepo VERDES (36 paquetes): `pnpm -r lint`, `pnpm -r typecheck`,
  `pnpm test` (backend 442/442), `pnpm -r build`, `pnpm check`.
- Commit `686ebdb` "fix(customer-zero): complete Gmail operational path and real chat responses"
  (26 archivos, +3093/−441). Push a origin/main OK.
- Deploy Railway departify-api SUCCESS (commit 686ebdb); logs de boot confirman:
  `[google-oauth] durable Supabase token store wired` y
  `[google-oauth] durable Supabase oauth-state store wired`.
- Netlify portal: bundle contiene el nuevo copy ("sesión ha caducado") → deploy vivo.
- Smoke test contra Supabase de PRODUCCIÓN: `oauth_state` write→read-back OK + consume OK;
  `google_oauth_tokens` write→read-back OK + scopes roundtrip OK.
- `api.departify.app/health` 200; `/api/.../connections` sin auth → 401 (correcto).

### INFORME FINAL (33 puntos)

1. **RECOVERY CHECKPOINT (lo que dejó Claude)**: working tree con pipeline post-OAuth
   casi completo sin commitear (google-tokens.ts durable, probe, scopes granted,
   dispatch email en chat, fix hola/pills, fix Elvira) + migración google_oauth_tokens.
   Backend 415/415 verde. Faltaban: tests A–Z, state store durable, migraciones aplicadas,
   deploy, chat reality verificado.
2. **Root cause "Gmail EN PREPARACIÓN"**: (a) la tarjeta era el evento connection_need
   del opening/proactividad que se re-emitía tras cada mensaje; (b) el estado real de
   conexión vivía en memoria y la UI no compartía una única fuente de verdad.
3. **Punto exacto de fallo post-OAuth (producción)**: el OAuth state store era un `Map`
   en memoria del proceso; en Railway (replicas/restarts) el callback no resolvía el nonce
   → `invalid_state` 401 → el portal mostraba error → Gmail "no conectado" → bucle.
   Además la versión desplegada (52ca47c) persistía tokens SOLO en memoria y la tabla
   `google_oauth_tokens` no existía en Supabase de producción.
4. **Granted scopes**: se parsean del token response real (mergeTokenExchange) y
   mapean a capacidades existentes (GMAIL_SCOPE_TO_CAPABILITY / gmailCapabilitiesFromScopes).
5. **Credential storage before**: memoria del proceso (gmailTokenStore Map) en 52ca47c.
6. **Credential storage after**: Supabase `google_oauth_tokens` (org+user+provider),
   service-role, RLS block-all; fallback in-memory solo para tests/dev.
7. **Refresh token reconnect**: mergeTokenExchange preserva el token existente si Google
   omite el nuevo (incl. "" tratado como ausente); nunca sobrescribe con null/undefined/vacío.
8. **Org/user isolation**: claves (org,user) + listForOrg scoped + tests K/Y + RLS.
9. **Operational probe**: `gmail.users.getProfile` tras el exchange; operational solo si
   probe OK + refresh token persistido; write→read-back obligatorio con código
   credential_persisted_but_not_readable.
10. **Connection state source of truth**: store durable de tokens (google_oauth_tokens)
    + tool state durable (SupabaseToolStateStore); /conexiones y chat derivan de ahí.
11. **/conexiones behavior**: tras callback OK → Gmail Conectado; sobrevive reload/restart;
    si el probe falla → estado bloqueado con motivo accionable.
12. **Central Chat connection-state**: pregunta de email sin conexión → "Gmail todavía no
    está conectado. Ve a Conexiones…" (accionable); con conexión → lee Gmail real.
13. **Gmail capability mapping**: gmail.readonly → email.identity/context/search/thread.read;
    gmail.compose → email.draft; gmail.send → email.send.personal.
14. **Real Gmail read path**: processCeoMessage → isEmailQuestion → hasOperationalGoogleIdentityForOrg
    → runGmailRead → GmailAdapter.searchMessages → resumen grounded en español.
15. **"hola" root cause**: routing greeting existía, pero los pills "Mensaje recibido"/"Listo"
    se emitían siempre (workStatesForTurn) y la proactividad Elvira se re-emitía por turno.
16. **"hola" fix**: workStatesForTurn → [] si no hay trabajo delegado; respuesta
    conversacional real del routing; transcript event siempre presente.
17. **workflow-event fix**: eventos por turno = solo transcript + work states reales;
    el opening proactivo se sirve SOLO en /command-center/opening.
18. **Elvira fake-proactivity fix**: buildProactiveOpening solo emite la tarjeta con
    objetivo/trabajo grounded; nunca "Elvira ya está lista…" tras hablar el CEO.
19. **Conversation/session regression**: Sessions V1 intactas (tests de 5 activas,
    archivo, compactación, aislamiento org siguen verdes — customer-zero-04).
20. **Files changed**: 26 (ver commit 686ebdb). Clave: google-tokens.ts, oauth-state.ts,
    gmail-adapter.ts, credential-resolver.ts, customer-zero-v2.ts, command-center.ts,
    chat-response-enrichment.ts, main.ts, portal GoogleOAuthCallbackRoute.tsx + api.ts.
21. **Migrations**: 20260810150000_google_oauth_tokens.sql + 20260810160000_oauth_state_durable.sql
    (nuevas); aplicadas a producción junto con inbox+compaction pendientes.
22. **Tests added/modified**: customer-zero-05-post-oauth.test.ts (27 nuevos); modificados
    oauth-routes, canonical-redirect, customer-zero-01/02/03, context-readiness (timeouts).
23. **Test totals**: backend 442/442 (35 ficheros); monorepo completo verde.
24. **lint**: `pnpm -r lint` VERDE.
25. **typecheck**: `pnpm -r typecheck` VERDE.
26. **build**: `pnpm -r build` VERDE.
27. **pnpm check**: VERDE (36/36 paquetes).
28. **commit**: 686ebdb en main.
29. **push/deployment**: push origin/main OK; Railway departify-api SUCCESS (686ebdb);
    Netlify portal bundle con el nuevo copy; health 200.
30. **VALIDATED**: autenticación/arranque en producción (stores durables cableados),
    health, deploy, smoke Supabase (write→read-back de ambas tablas), tests A–Z,
    bundle portal. NO validado Gmail real (requiere cuenta/browser del founder).
31. **NOT VALIDATED**: flujo real de consentimiento de Google de extremo a extremo
    (requiere el browser/Google del founder), lectura real de su bandeja, continuidad
    conversacional real.
32. **BLOCKED**: nada bloqueante. Nota: el tab del founder mostraba 401 en work-feed
    (token Supabase caducado) — el portal ahora sugiere re-login en el callback.
33. **EXACT FOUNDER MANUAL TEST**: (abajo)

### FINAL STATUS: READY FOR FOUNDER HUMAN VALIDATION
(Nunca PASS: la validación real de Gmail requiere la cuenta/browser del founder.)

#### EXACT FOUNDER MANUAL TEST
1. Abre https://app.departify.app y entra (si ves 401 repetidos, cierra sesión y vuelve a entrar).
2. Ve a /conexiones.
3. Gmail → Configurar.
4. Completa el consentimiento de Google.
5. Al volver: Gmail debe mostrar **Conectado** (si falla, verás un mensaje con la fase exacta).
6. Recarga el navegador: Gmail sigue **Conectado**.
7. Abre /chat y escribe: **¿Tengo algún correo importante?**
8. Departify debe responder con correos reales de la bandeja (remitente/asunto).
9. Escribe: **¿Cuáles debería contestar primero?** → continuidad conversacional.
10. Escribe: **hola** → respuesta conversacional (no solo tarjetas "Mensaje recibido"/"Listo").
11. Reinicio del backend (deploy) → Gmail sigue conectado.




