# GOAL — Sprint 28A — Business Discovery Stabilization

## Objetivo

- No implementar ninguna funcionalidad nueva.
- No crear paquetes nuevos.
- No modificar la arquitectura.
- No continuar al Sprint 29.
- El único objetivo es dejar `@departify/business-discovery` completamente estable y alineado con la arquitectura del proyecto.

## Trabaja en este orden

### Fase 1
Encontrar la causa raíz de todos los errores. No arreglar síntomas. Agrupar los errores por causa.

### Fase 2
Corregir únicamente las causas raíz. Está prohibido introducir soluciones temporales. No usar:
- `eslint-disable`
- `@ts-ignore`
- `@ts-expect-error`
- `any` innecesarios

### Fase 3
Resolver el conflicto entre dominio y tests. Si un test falla porque el contrato cambió, justificarlo antes de modificar el test. Nunca modificar tests únicamente para que pasen.

### Fase 4
Corregir:
- conflicto de export de `GapAnalysisResult`
- validación de `requestedAt`
- integración correcta de `FounderBrain` dentro de `GapAnalysis`
- filtrado correcto por importancia
- manejo correcto de errores del Discovery Service

### Fase 5
Eliminar:
- imports sin usar
- variables sin usar
- código muerto
- deuda técnica generada durante el Sprint 28

## Validaciones finales obligatorias

Todo debe terminar en verde:
- `pnpm lint`
- `pnpm typecheck`
- `pnpm test`
- `pnpm build`
- `pnpm check`

## Restricciones

No modificar:
- packages ya estables.
- contratos públicos.
- bounded contexts.
- arquitectura.
- documentación funcional.

No crear funcionalidades nuevas. No iniciar Sprint 29.

## Entrega

Cuando finalices:
1. Ejecuta todas las validaciones.
2. Realiza commit.
3. Haz push a main.
4. Entrega un informe indicando: causa raíz encontrada; cambios realizados; tests corregidos; validaciones ejecutadas; commit; push; confirmación de que Sprint 28 queda completamente cerrado.

## Criterios de "hecho" (Definition of Done)

- [ ] `pnpm lint` en verde en todos los paquetes.
- [ ] `pnpm typecheck` en verde en todos los paquetes.
- [ ] `pnpm test` en verde en todos los paquetes.
- [ ] `pnpm build` en verde en todos los paquetes.
- [ ] `pnpm check` en verde en todos los paquetes.
- [ ] Sin `eslint-disable`, `@ts-ignore`, `@ts-expect-error`, ni `any` innecesario introducidos.
- [ ] Ningún package estable, contrato público, bounded context, arquitectura ni documentación funcional modificada.
- [ ] `@departify/business-discovery` compila, testea y buildea sin errores.
- [ ] Commit creado y push realizado a `main`.
