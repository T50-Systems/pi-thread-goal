# Goal Domain Leaks Refactor Plan

## Context

Tras el refactor SOLID anterior, `runtime.ts` quedó mucho más pequeño, pero todavía quedan boundary/domain leaks:

- `src/types.ts` mezcla tipos de dominio (`GoalState`, `GoalEvent`) con contratos de runtime/Pi (`RuntimeExtensionAPI`, `GoalRuntimeContext`, eventos de sesión).
- `src/continuation.ts` contiene lógica de continuidad, pero también sabe persistir (`saveGoalState`), enviar mensajes (`sendUserMessage`) y notificar UI.
- `src/evaluator.ts` mezcla política/parsing con adapter infra: dynamic import de `@earendil-works/pi-ai/compat`, auth/model registry y nombres concretos de modelos.
- `validateGoalCompletion(...)` vive en `src/tools.ts`, que es un módulo tool-facing; `src/next-action.ts` depende de `tools.ts` para política de completion.

El objetivo es separar dominio, contratos de runtime, políticas puras y adapters sin cambiar comportamiento de `/goal` ni los hardenings recientes.

## Approach

Hacer una segunda pasada arquitectónica por slices pequeños:

1. Separar tipos de dominio de tipos runtime/Pi.
2. Mover política de completion fuera de `tools.ts`.
3. Separar evaluator policy/service del adapter Pi AI.
4. Reducir leaks de `continuation.ts` introduciendo puertos explícitos para persistencia, envío y notificación.
5. Actualizar imports/tests y validar que los invariantes de continuidad no cambian.

No se debe cambiar semántica de:

- watchdog `continuationPendingAt` + `CONTINUATION_WATCHDOG_MS`.
- timeout default `45_000ms` y env `GOAL_EVALUATOR_TIMEOUT_MS`.
- clasificación retryable.
- condiciones `isIdle()` / `hasPendingMessages()`.
- validación de completion antes de marcar goals como complete.

## Files to modify

- `src/types.ts`
- `src/runtime-types.ts` *(nuevo)*
- `src/completion-policy.ts` *(nuevo)*
- `src/evaluator.ts`
- `src/evaluator-adapter.ts` *(nuevo)*
- `src/evaluator-policy.ts` *(nuevo, si conviene separar parse/timeout/error classification)*
- `src/continuation.ts`
- `src/runtime.ts`
- `src/tools.ts`
- tests:
  - `tests/continuation.test.ts`
  - `tests/evaluator.test.ts`
  - `tests/next-action.test.ts`
  - `tests/tools.test.ts`
  - nuevos tests para `completion-policy`, `evaluator-policy`/`evaluator-adapter` si aplica.

## Reuse

- `saveGoalState(...)` en `src/state.ts` como persistencia existente; se usará desde un puerto/adapter, no desde lógica pura si se separa.
- `renderGoalEvaluationPrompt(...)` y `renderGoalContinuationPrompt(...)` en `src/prompts.ts`.
- `validateGoalCompletion(...)` implementación actual, movida sin cambiar reglas.
- Tests existentes de:
  - `tests/continuation.test.ts`
  - `tests/evaluator.test.ts`
  - `tests/next-action.test.ts`
  - `tests/tools.test.ts`

## Steps

- [ ] **Slice 1 — Separar tipos de dominio y runtime**
  - Mantener en `src/types.ts` solo dominio y eventos de estado:
    - `GoalStatus`, `GoalProgress`, `GoalUsage`, `GoalPauseReason`, `GoalState`, `GoalEvent`, `GoalStateEntry`, `GoalStateSnapshot`.
  - Crear `src/runtime-types.ts` para:
    - `GoalRuntimeContext`
    - `RuntimeExtensionAPI`
    - `ContextMessage`, `ContextEvent`
    - `SessionBeforeCompactEvent`, `AgentEndEvent`, `CompactionResumeEvent`, `RuntimeIdleContext`, `SessionStartEvent`
    - tipos evaluator infra si siguen compartidos.
  - Actualizar imports en `runtime.ts`, `continuation.ts`, `evaluator.ts`, tests.

- [ ] **Slice 2 — Extraer completion policy**
  - Crear `src/completion-policy.ts` con:
    - `validateGoalCompletion(...)`
    - helpers privados `hasPendingCurrentWork`, `doneMentionsCurrentWork`, `mentionsCompletionEvidence`.
  - Actualizar `src/tools.ts` para importar y reexportar si hace falta compatibilidad interna.
  - Actualizar `src/next-action.ts` para importar desde `completion-policy.ts`, no desde `tools.ts`.
  - Mover/agregar tests de completion policy desde `tools.test.ts` o cubrir directamente en `completion-policy.test.ts`.

- [ ] **Slice 3 — Separar evaluator policy de adapter**
  - Crear `src/evaluator-policy.ts` para funciones puras:
    - `parseEvaluatorDecision(...)`
    - `resolveEvaluatorTimeoutMs(...)`
    - `classifyGoalRuntimeError(...)`
    - constantes `DEFAULT_EVALUATOR_TIMEOUT_MS`, `EVALUATOR_TIMEOUT_ENV`.
  - Mantener tests de parse/timeout/classification contra `evaluator-policy.ts`.
  - `evaluator.ts` debe importar estas políticas.

- [ ] **Slice 4 — Crear evaluator adapter**
  - Crear `src/evaluator-adapter.ts` para:
    - dynamic import de `@earendil-works/pi-ai/compat`.
    - tipos `EvaluatorMessage`, `EvaluatorResponse`, `EvaluatorComplete`.
    - `completeGoalEvaluation(...)`.
  - `evaluator.ts` queda como application service:
    - elegir modelo.
    - resolver auth.
    - construir prompt/message.
    - llamar adapter con timeout.
    - parsear respuesta.
  - El subpath correcto debe seguir siendo `@earendil-works/pi-ai/compat`, no `.js`.

- [ ] **Slice 5 — Reducir leak en continuation con puertos explícitos**
  - Introducir tipos locales claros en `src/continuation.ts`, por ejemplo:
    - `GoalContinuationStore` con `markPending(goal, reason)`.
    - `GoalMessageQueue` con `send(prompt, mode)`.
    - `GoalContinuationNotifier` con `notify(...)` opcional.
  - Mantener una función adapter/factory en runtime o continuation que conecte esos puertos a Pi:
    - `saveGoalState(...)`
    - `runtimePi.sendUserMessage(...)`
    - `runtimeCtx.ui?.notify(...)`
  - Separar helpers puros (`shouldRetryPendingContinuation`, `shouldQueueGoalContinuation`) de la función impura `queueGoalContinuation(...)`.
  - Tests deben verificar tanto helpers puros como adapter behavior.

- [ ] **Slice 6 — Actualizar runtime imports y mantener orquestación**
  - `runtime.ts` debe importar runtime contracts desde `runtime-types.ts`.
  - `runtime.ts` no debe importar policy desde tool-facing modules.
  - Confirmar que `runtime.ts` sigue siendo orquestador y no vuelve a crecer con detalles de infra.

- [ ] **Slice 7 — Tests y compatibilidad**
  - Actualizar tests existentes para nuevos módulos.
  - Agregar tests directos para:
    - `completion-policy.ts`
    - `evaluator-policy.ts`
    - continuidad con puertos/adapters.
  - Mantener tests de integración ligera en `runtime.test.ts`.

- [ ] **Slice 8 — Revisión de boundaries**
  - Ejecutar grep/check manual:
    - `src/types.ts` no debe contener `Runtime`, `sessionManager`, `modelRegistry`, `sendUserMessage`, `ui`.
    - `src/next-action.ts` no debe importar `tools.ts`.
    - `src/evaluator-policy.ts` no debe importar `@earendil-works/*` ni runtime context.
    - `src/evaluator-adapter.ts` es el único módulo con `@earendil-works/pi-ai/compat`.
  - Documentar cualquier leak intencional si queda alguno.

## Verification

- [ ] `cd C:/dev/pi/T50-Systems/pi-thread-goal && npm run typecheck`
- [ ] `cd C:/dev/pi/T50-Systems/pi-thread-goal && npm test`
- [ ] `lsp_diagnostics` sobre:
  - `src/types.ts`
  - `src/runtime-types.ts`
  - `src/completion-policy.ts`
  - `src/continuation.ts`
  - `src/evaluator.ts`
  - `src/evaluator-policy.ts`
  - `src/evaluator-adapter.ts`
  - `src/next-action.ts`
  - `src/runtime.ts`
  - tests modificados/nuevos.
- [ ] `lens_diagnostics mode=delta severity=all`
- [ ] `git diff --check`
- [ ] Boundary grep:
  - `grep -R "sessionManager\|modelRegistry\|sendUserMessage\|RuntimeExtensionAPI" -n src/types.ts src/next-action.ts src/evaluator-policy.ts src/completion-policy.ts`
  - `grep -R "@earendil-works/pi-ai/compat" -n src`
- [ ] Revisión semántica de invariantes:
  - watchdog pendiente reintenta igual.
  - timeout default/env igual.
  - retryable errors igual.
  - completion validation igual.
  - no cambios en prompts de continuación/evaluación salvo imports.
- [ ] `pi install .`
- [ ] Sincronizar `C:/Users/c___h/.pi/agent/settings.json` → `C:/dev/pi/my-pi-cli/agent/settings.json`

## Risks and mitigations

- **Riesgo:** over-engineering con demasiados módulos.
  - **Mitigación:** extraer solo boundaries reales; mantener APIs pequeñas.
- **Riesgo:** romper imports por ciclos.
  - **Mitigación:** `types.ts` y `runtime-types.ts` deben ser leaf modules; policy modules no importan runtime.
- **Riesgo:** cambiar comportamiento del completion policy al moverlo.
  - **Mitigación:** mover implementación textual primero, tests antes/después.
- **Riesgo:** tests demasiado acoplados a implementación.
  - **Mitigación:** tests por comportamiento observable: decisiones, ports llamados, errores clasificados.
