# GOAL AUTÓNOMO — DEPARTIFY — CONTINUE INTERRUPTED P0 FROM CLAUDE CODE

## POST-OAUTH GMAIL OPERATIONAL RECOVERY + CENTRAL CHAT REALITY

Se continúa una implementación INTERRUMPIDA de otro agente (Claude Code).

REGLAS CRÍTICAS:
- NO reiniciar el sprint.
- NO fiarse del informe escrito previo como verdad actual.
- NO rehacer trabajo completado a ciegas.
- NO revertir cambios sin commitear.
- NO descartar el working tree actual.
- NO `reset --hard`. NO `checkout` sobre modificaciones existentes.
- El agente anterior se quedó sin tokens MID-IMPLEMENTACIÓN.

Primera responsabilidad: RECUPERAR EL ESTADO EXACTO actual desde
git + working tree + tests y continuar desde ahí.

## Producto
Departify es un Sistema Operativo de Negocio para PYMEs/CEOs.
El CEO no sabe ni le importa AI, modelos, OAuth, scopes, tokens o infraestructura.
El CEO quiere que la empresa funcione.

## Criterio de aceptación dorado (DoD de producto)

1. CEO: "¿Tengo algún correo importante?" → Departify LEE de verdad el Gmail
   conectado del CEO y da una respuesta útil y grounded (datos reales).
2. CEO: "hola" → Departify responde conversacionalmente.
   NO: "Mensaje recibido", "Listo", "Elvira está lista para ponerse a trabajar."

## Hecho = (criterio de done)

- [ ] Auditoría de recuperación completa del working tree (A–G del goal) documentada.
- [ ] P0-1..P0-10 implementados/resueltos respetando la arquitectura existente
      (sin runtimes nuevos, sin OAuthV2, sin ChatRuntimeV2, sin refactors masivos).
- [ ] P0-2: credencial Google durable (Supabase u otro repo seguro existente),
      NO en memoria de proceso. Sobrevive a reinicio de Railway.
- [ ] P0-3: reconnect sin refresh_token nuevo preserva el existente.
- [ ] P0-4: scopes GRANTED (no requested) → capacidades existentes exactas.
- [ ] P0-5: probe operacional real Gmail (readonly) antes de declarar connected.
- [ ] P0-6: una única fuente de verdad de conexión (Connections + Central Chat compatibles).
- [ ] P0-7: "¿Tengo algún correo importante?" → GmailAdapter → API real → respuesta grounded.
- [ ] P0-8: "hola" → respuesta conversacional real del asistente.
- [ ] P0-9: tarjeta Elvira-ready NO se repite tras cada mensaje del CEO (solo proactividad legítima y grounded).
- [ ] P0-10: Central Chat Sessions V1 intacta (5 activas, archivo, Supabase, compactación, aislamiento org).
- [ ] Tests A–Z del goal escritos y VERDES sin debilitar aserciones.
- [ ] `pnpm -r lint`, `pnpm -r typecheck`, tests, `pnpm -r build`, `pnpm check` verdes.
- [ ] Commit único coherente (sugerido: "fix(customer-zero): complete Gmail operational path and real chat responses").
- [ ] Push (solo si quality gates verdes; sin force push) y verificación del deploy si aplica.
- [ ] Informe final con los 33 puntos y FINAL STATUS en {PASS | READY FOR FOUNDER HUMAN VALIDATION | BLOCKED | FAIL}.
- [ ] NUNCA llamarlo PASS sin validación real de Gmail en producción (cuenta real).

STOP tras este P0. NO Calendar, NO Drive, NO otro departamento, NO otro sprint.
Customer Zero primero. El objetivo NO es "OAuth funciona": es que el CEO pregunte
por su correo y Departify SEPA la respuesta.
