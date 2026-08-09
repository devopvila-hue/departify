# Control Plane UX — Tu Empresa

Guía de producto para la pantalla principal de Departify (ENGINE 04).

## Principio

Un CEO debe entender la pantalla en menos de 10 segundos: quién dirige cada
departamento, qué están haciendo, cuántos empleados digitales tienen, qué
herramientas usan, qué objetivos están activos, qué necesita su aprobación y
qué resultados se han producido.

## Estructura

### Tu Empresa (Control Plane, /inicio)

- **Resumen de la empresa** (datos reales del backend): empleados digitales,
  trabajando ahora, herramientas conectadas, aprobaciones pendientes, objetivos
  activos.
- **Organigrama**: CEO arriba; debajo, la tarjeta de departamento de Elvira
  (Marketing) con estado, objetivo y acciones («Ver Marketing»,
  «Hablar con Elvira»).
- **Empleados digitales**: tarjetas con rol de negocio, estado (Disponible /
  Trabajando) y trabajo actual al pulsar.
- **Herramientas**: estados honestos (Conectado / No conectado).
- **Aprobaciones**: bandeja con la propuesta, coste y acciones Aprobar /
  Rechazar.
- **Actividad**: feed empresarial.
- **Resultados**: entregables.

### Marketing (/marketing)

- Cabecera: Elvira — Directora de Marketing + estado.
- Objetivo actual + progreso (barra).
- Empleados digitales, herramientas, aprobaciones, actividad, resultados.
- **Chat con Elvira integrado** de forma natural (Portal → Backend →
  EngineAdapter → OpenClaw → Vertex).
- Crear nuevo objetivo (formulario).

### Aprobaciones (/aprobaciones)

- Inbox del CEO: propuestas de Elvira con coste y acciones.

## Lenguaje

- Español comercial. Sin spanglish.
- Department → Departamento; Agents → Empleados digitales; Tools →
  Herramientas; Approvals → Aprobaciones; Current work → Trabajo actual;
  Activity → Actividad; Objectives → Objetivos; Results → Resultados;
  Connected → Conectado; Not connected → No conectado.

## Estados (mapeo técnico → empresarial)

- idle → Disponible
- running → Trabajando
- waiting_approval → Esperando tu aprobación
- blocked → Bloqueado
- error → Necesita atención
- offline → No disponible

## Reglas

- No hardcodear estado ficticio si hay backend.
- No mostrar subagentes por defecto (12 empleados digitales, no 12 nodos).
- No exponer OpenClaw/agent/skill/tool-runtime/prompt/token.
- Movimiento sutil solo para comunicar estado (dot pulsante, drawer).
- Accesible: navegación por teclado, focus visible, etiquetas semánticas,
  contraste, reduced motion.
- Responsive: jerarquía vertical en móvil, drawer en vez de org chart
  horizontal.
