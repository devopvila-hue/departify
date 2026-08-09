# Marketing Golden Path — Customer Zero E2E

Documento de producto: el recorrido completo del CEO con el primer
departamento realmente funcional de Departify.

## El recorrido

```
CEO
→ Departify Portal (Control Plane + chat)
→ Departify Backend
→ MarketingService
→ EngineAdapter
→ OpenClaw Gateway
→ Google Vertex AI (gemini-2.5-flash)
→ plan / resultado / actividad / aprobación
→ UI empresarial
```

## Paso a paso

1. **El CEO abre el portal** y ve «Tu empresa» (Control Plane): Elvira,
   Directora de Marketing, con su estado, empleados digitales, herramientas y
   objetivo.
2. **Entra en Marketing** (/marketing) y crea un objetivo:

   > «Quiero conseguir 20 leads cualificados este mes. Tenemos una landing y un
   > presupuesto de 500 €.»

   Se crea un `BusinessObjective` (activo, progreso 0%).
3. **El CEO habla con Elvira**:

   > «Analiza qué harías y prepara el plan.»

   Elvira responde como Directora de Marketing: usa el contexto del negocio,
   identifica restricciones, pide la información que falta y propone una
   campaña. Se registra actividad y se solicita una aprobación.
4. **El CEO ajusta los canales**:

   > «Prioriza LinkedIn y Google Ads. No quiero TikTok.»

   Elvira lo recuerda en la misma sesión (memoria multi-turno real vía
   EngineAdapter).
5. **El CEO aprueba** la campaña propuesta en el inbox de Aprobaciones.
6. **El estado se actualiza**: actividad refleja «Aprobación concedida», el
   objetivo y el progreso se muestran en el Control Plane.
7. **El CEO reinicia backend/engine** y confirma que todo persiste (engine
   session + objetivos/actividad en la memoria del servicio).

## Comportamiento verificado (real, sin mocks)

- Elvira produce un plan concreto de negocio, no una respuesta genérica.
- No menciona OpenClaw, prompts, tokens, agentes, skills ni sesiones técnicas.
- La memoria multi-turno conserva: objetivo de 20 leads, presupuesto 500 €,
  LinkedIn, Google Ads, exclusión TikTok.
- La actividad y las aprobaciones usan lenguaje empresarial.
- Las herramientas muestran estados honestos («No conectado» cuando no lo
  están).
- Los empleados digitales se presentan como roles de negocio.

## Estado

- ENGINE 03 — PASS (23/23 tests real engine).
- ENGINE 04 — PASS (Control Plane funcional, 23/23 tests portal).
- MARKETING — LOCAL E2E PASS.
- DEPLOY 01 — PRODUCTION PASS (engine/backend/portal deployed, Golden Path
  verificado end-to-end en producción — ver `docs/deploy/deploy01-production-test.md`).
- GOLDEN DEPARTMENT — OPERATIVE en producción.
