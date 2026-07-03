# Plan: importar robustez de `narumiruna/pi-goal` a `pi-thread-goal`

Este plan está escrito para revisarse con Plannotator:

```text
/plannotator-annotate docs/GOAL_HARDENING_PLANNOTATOR_PLAN.md
```

Objetivo: incorporar cinco ideas de robustez al flujo `/goal` actual sin perder las mejoras UX ya implementadas: widget superior, fondo sutil, `/goal dismiss`, `/goal edit`, output silencioso y estado branch-aware.

## Estado base observado

- `src/runtime.ts` ya evalúa al final de cada turno, acumula usage, continúa automáticamente y pausa tras `MAX_AUTOMATIC_CONTINUATION_TURNS = 25`.
- `src/commands.ts` ya parsea flags básicas `--yes`, `--replace`, `--start`, y contiene `/goal dismiss` + editor estructurado.
- `src/tools.ts` registra `complete_goal`, `create_goal`, `get_goal`, `update_goal_progress`, pero `complete_goal` todavía no valida contradicciones ni devuelve `terminate: true`.
- `src/state.ts` persiste estado event-sourced en `appendEntry`, pero `GoalState` aún no tiene token budget ni motivo/categoría de pausa/error.
- Tests actuales cubren command parsing, state reducer, runtime guards, widget/tools; hay que extenderlos antes de tocar comportamiento riesgoso.

## No hacer en este cambio

- No reintroducir statusline `/goal active...` debajo del input.
- No reemplazar la arquitectura event-sourced por archivos externos.
- No cambiar semántica de `/goal dismiss` ni ocultar automáticamente goals completos.
- No implementar multi-goal queues ni `/loop`.
- No hacer un port literal de `narumiruna/pi-goal`; importar patrones, no estructura completa.

---

## Fase 1 — Token budget configurable para `/goal --tokens 100k`

### Resultado esperado

El usuario puede crear o reemplazar un goal con límite de tokens; el runtime pausa automáticamente cuando el consumo acumulado alcanza el presupuesto.

### Cambios propuestos

- [ ] `src/types.ts`: extender `GoalState` con `tokenBudget?: number` y quizá `pauseReason?: "manual" | "turn-limit" | "token-budget" | "error"`.
- [ ] `src/types.ts`: extender eventos `GoalCreateEvent`, `GoalReplaceEvent`, `GoalEditEvent` con `tokenBudget?: number` cuando aplique.
- [ ] `src/state.ts`: persistir y normalizar `tokenBudget`; limpiar valores inválidos o <= 0.
- [ ] `src/commands.ts`: agregar parsing de `--tokens <value>` y `--tokens=<value>`.
- [ ] `src/commands.ts`: soportar sufijos `k`, `m`, y números con `_` o `,` si queremos UX amable (`100k` → `100000`).
- [ ] `src/commands.ts`: pasar `tokenBudget` al crear/reemplazar goals.
- [ ] `src/commands.ts`: incluir `Token budget:` en `/goal edit` para poder modificarlo sin recrear el goal.
- [ ] `src/runtime.ts`: agregar helper `hasReachedTokenBudget(goal)` usando `goal.usage.total`.
- [ ] `src/runtime.ts`: revisar budget después de guardar el evento `evaluation`, antes de continuar automáticamente.
- [ ] `src/ui.ts`: mostrar budget/uso de forma compacta en widget y overlay, sin statusline.
- [ ] `README.md` y `CHANGELOG.md`: documentar `/goal --tokens 100k`.

### Tests

- [ ] `tests/commands.test.ts`: parsea `ship --tokens 100k`, `--tokens=100k`, `--tokens 1m`.
- [ ] `tests/commands.test.ts`: rechaza o ignora formatos inválidos de forma determinística.
- [ ] `tests/state.test.ts`: create/edit preservan `tokenBudget`; resume reinicia usage pero conserva budget.
- [ ] `tests/runtime.test.ts`: `hasReachedTokenBudget` sólo pausa goals activos con budget alcanzado.
- [ ] `tests/ui.test.ts`: render compacto muestra uso/budget sin romper el fondo sutil.

### Criterio de aceptación

- [ ] Crear `/goal ship --tokens 100k` persiste `tokenBudget: 100000`.
- [ ] Al alcanzar el límite, el goal queda `paused`, no continúa automáticamente, y la notificación indica token budget alcanzado.
- [ ] `npm run typecheck` pasa.
- [ ] `npm test` pasa.

---

## Fase 2 — Bloquear stale tool calls tras pause/error/complete

### Resultado esperado

Las herramientas `complete_goal` y `update_goal_progress` no pueden mutar un goal si el modelo llama una herramienta con estado viejo después de que el goal fue pausado, completado, reemplazado o falló.

### Cambios propuestos

- [ ] `src/tools.ts`: exigir que mutaciones verifiquen `current.status === "active"` antes de completar o actualizar progreso.
- [ ] `src/tools.ts`: si el goal actual no está activo, lanzar error claro: `Goal is not active; current status is paused/complete`.
- [ ] `src/tools.ts`: si el estado actual cambió desde la inyección de contexto, preferir no mutar. Si no existe un `goalId` explícito en tool params, validar al menos que el estado activo siga existiendo.
- [ ] `src/tools.ts`: considerar extender params internos opcionalmente con `goal_id` para que futuras versiones bloqueen llamadas contra goal anterior; mantenerlo opcional para compatibilidad.
- [ ] `src/runtime.ts`: cuando el runtime pausa por turn-limit/token/error, asegurarse de que no quede continuación encolada (`clearQueuedGoalContinuation`).
- [ ] `src/prompts.ts`: reforzar contexto oculto: herramientas de progreso/completion sólo aplican al goal activo actual.

### Tests

- [ ] `tests/tools.test.ts`: `complete_goal` falla si el goal está `paused`.
- [ ] `tests/tools.test.ts`: `update_goal_progress` falla si el goal está `complete`.
- [ ] `tests/tools.test.ts`: no se appendEntry cuando se rechaza una tool call stale.
- [ ] `tests/runtime.test.ts`: al pausar por límite se limpia la continuation guard.

### Criterio de aceptación

- [ ] Ninguna tool muta un goal no activo.
- [ ] El error es accionable y no sugiere que la operación haya tenido éxito.
- [ ] Tests cubren pause, complete y reemplazo/goal ausente.

---

## Fase 3 — Clasificación retryable vs non-retryable para interrupciones/errores

### Resultado esperado

El runtime distingue errores temporales que pueden reintentarse de errores que deben pausar el goal para intervención humana.

### Cambios propuestos

- [ ] `src/runtime.ts`: definir `GoalRuntimeInterruptionKind = "retryable" | "non-retryable"` y helper `classifyGoalRuntimeError(error)`.
- [ ] `src/runtime.ts`: clasificar como retryable señales tipo abort/compact/retry/transient provider cuando Pi indica `willRetry` o error abortable.
- [ ] `src/runtime.ts`: clasificar auth/config/model missing como non-retryable.
- [ ] `src/runtime.ts`: para retryable, no marcar evaluación ni pausar; dejar que Pi reintente o el siguiente ciclo retome sin duplicar continuaciones.
- [ ] `src/runtime.ts`: para non-retryable, pausar goal con `pauseReason: "error"` y `lastEvaluationReason` corto.
- [ ] `src/state.ts`: opcionalmente agregar `pauseReason`/`pauseMessage` en `GoalPauseEvent` para distinguir pausa manual vs error.
- [ ] `src/ui.ts`: mostrar pausa por error de forma compacta en widget/overlay.

### Tests

- [ ] `tests/runtime.test.ts`: `classifyGoalRuntimeError` cubre abort/retry/auth/model/error desconocido.
- [ ] `tests/runtime.test.ts`: retryable no encola continuación duplicada.
- [ ] `tests/state.test.ts`: pause con reason persiste y resume limpia reason/error si corresponde.
- [ ] `tests/ui.test.ts`: pausa por error se renderiza sin ruido excesivo.

### Criterio de aceptación

- [ ] Los errores no retryable paran el loop en estado `paused`.
- [ ] Los retryable no completan ni pausan falsamente.
- [ ] No hay duplicados de continuación tras compact/retry/abort.

---

## Fase 4 — Validación anti-completado contradictorio para `complete_goal`

### Resultado esperado

`complete_goal` no puede cerrar un objetivo si el propio estado del goal contradice la finalización: blockers pendientes, current work pendiente, criterios no satisfechos, o evidencia vacía/contradictoria.

### Cambios propuestos

- [ ] `src/tools.ts`: agregar `validateGoalCompletion(current, evidence)` antes de `saveGoalState(... complete ...)`.
- [ ] `src/tools.ts`: bloquear completado si `progress.blocked.length > 0` salvo evidencia explícita que explique resolución; decisión a tomar: exigir update_progress primero o permitir evidencia con override.
- [ ] `src/tools.ts`: bloquear completado si `acceptanceCriteria.length > 0` y no hay evidencia textual que mencione criterios o pruebas.
- [ ] `src/tools.ts`: bloquear completado si `progress.current` contiene lenguaje de trabajo pendiente (`write`, `implement`, `fix`, `investigate`) y `done` no refleja ese trabajo.
- [ ] `src/runtime.ts`: aplicar la misma validación cuando el evaluador automático decide `met: true`; si falla, tratar como `met: false` con razón de contradicción.
- [ ] `src/prompts.ts`: ajustar guidelines de `complete_goal` para indicar que blockers/current deben estar resueltos antes de completar.

### Tests

- [ ] `tests/tools.test.ts`: blockers pendientes impiden `complete_goal`.
- [ ] `tests/tools.test.ts`: criteria presentes + evidencia vacía impide `complete_goal`.
- [ ] `tests/tools.test.ts`: estado limpio + evidencia suficiente permite completar.
- [ ] `tests/runtime.test.ts`: evaluator `met: true` no completa si la validación contradice.

### Criterio de aceptación

- [ ] `complete_goal` sólo completa goals activos y consistentemente terminados.
- [ ] Los rechazos explican qué falta actualizar.
- [ ] La validación automática y la herramienta comparten el mismo helper.

---

## Fase 5 — `terminate: true` cuando `complete_goal` completa el objetivo

### Resultado esperado

Cuando la herramienta `complete_goal` completa exitosamente, Pi recibe una señal de terminación para detener el turno/loop en vez de seguir generando trabajo innecesario.

### Cambios propuestos

- [ ] Revisar API actual de herramientas Pi para confirmar forma exacta (`terminate: true` en return, `details`, u otro campo soportado).
- [ ] `src/tools.ts`: cuando `complete_goal` produce un nuevo estado `complete`, devolver el shape soportado con `terminate: true`.
- [ ] `src/tools.ts`: no devolver `terminate: true` si la herramienta falla, no hay goal, el goal no está activo, o la validación anti-contradicción bloquea.
- [ ] `src/runtime.ts`: mantener comportamiento actual del evaluador automático: al completar desde runtime ya retorna sin encolar continuación.
- [ ] `README.md`: documentar que `complete_goal` finaliza el ciclo cuando completa de verdad.

### Tests

- [ ] `tests/tools.test.ts`: respuesta exitosa de `complete_goal` incluye `terminate: true`.
- [ ] `tests/tools.test.ts`: rechazos de `complete_goal` no incluyen terminate.
- [ ] `npm run typecheck` verifica el shape de retorno contra tipos de Pi, o se encapsula con tipo local si la SDK no lo declara.

### Criterio de aceptación

- [ ] Llamada exitosa a `complete_goal` completa el goal y detiene el flujo.
- [ ] Llamadas rechazadas no terminan el turno.
- [ ] No se rompe compatibilidad con tool `details.goal`.

---

## Orden recomendado de implementación

1. [ ] Fase 1: token budget.
2. [ ] Fase 2: stale tool-call block.
3. [ ] Fase 3: retryable/non-retryable.
4. [ ] Fase 4: anti-completado contradictorio.
5. [ ] Fase 5: terminate true.
6. [ ] Validación final: `npm run typecheck && npm test && pi install .`.
7. [ ] Smoke test manual en una sesión nueva de Pi con el paquete local instalado.

## Smoke tests manuales finales

- [ ] `/goal "hacer una tarea pequeña" --tokens 1k` pausa por token budget sin continuar indefinidamente.
- [ ] `/goal pause` seguido de una tool call stale no muta el goal.
- [ ] Un error no retryable del evaluator deja el goal pausado y visible.
- [ ] `complete_goal` con blockers pendientes falla con mensaje útil.
- [ ] `complete_goal` con evidencia suficiente completa y termina el turno.
- [ ] Goal completado sigue visible hasta `/goal dismiss`.
- [ ] Widget sigue arriba, con fondo sutil, sin statusline debajo del input.
