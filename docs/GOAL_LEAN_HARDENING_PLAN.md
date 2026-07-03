# Goal Runtime Lean Hardening Plan

## Context

El `goal runtime` ya quedó separado en boundaries claros: dominio, runtime types, policies, application services y adapters. Ahora falta una pasada mínima de endurecimiento para asegurar funcionamiento correcto sin agregar features ni complejidad innecesaria.

El foco no es cambiar comportamiento, sino proteger invariantes, evitar regresiones arquitectónicas y asegurar que los nodos críticos del dataflow fallen de forma segura.

## Approach

Aplicar una serie pequeña de guardrails y tests unitarios/contractuales:

1. Boundary tests para evitar que vuelvan leaks entre dominio/runtime/policies/adapters.
2. Tests de safety para completion, clasificación de errores y adapter propagation.
3. Invariante mínimo de `GoalState` en puntos críticos.
4. Confirmar persistencia de continuation pending antes de enviar mensajes.
5. Null-safety mínima en helpers de runtime.

Mantener el alcance lean:

- No agregar features nuevas.
- No introducir servicios pesados si una función pura basta.
- No tocar core `pi-coding-agent`.
- No cambiar prompts ni semántica de continuación/evaluación.

## Files to modify

- `src/continuation.ts`
- `src/state-invariants.ts` *(nuevo, si se aprueba)*
- `src/runtime.ts`
- `src/evaluator-policy.ts` *(tests principalmente; código solo si un test revela ambigüedad)*
- `src/next-action.ts` *(tests principalmente)*
- `tests/boundaries.test.ts` *(nuevo)*
- `tests/completion-policy.test.ts`
- `tests/next-action.test.ts`
- `tests/evaluator.test.ts`
- `tests/evaluator-adapter.test.ts`
- `tests/continuation.test.ts`
- `tests/runtime.test.ts`

## Reuse

- `validateGoalCompletion(...)` en `src/completion-policy.ts`.
- `decideGoalNextAction(...)` en `src/next-action.ts`.
- `classifyGoalRuntimeError(...)` en `src/evaluator-policy.ts`.
- `queueGoalContinuation(...)` y ports en `src/continuation.ts`.
- `saveGoalState(...)` en `src/state.ts`.
- Tests existentes como base:
  - `tests/continuation.test.ts`
  - `tests/evaluator.test.ts`
  - `tests/evaluator-adapter.test.ts`
  - `tests/completion-policy.test.ts`
  - `tests/next-action.test.ts`
  - `tests/runtime.test.ts`

## Steps

- [ ] **Step 1 — Boundary guardrail tests**
  - Crear `tests/boundaries.test.ts`.
  - Verificar que `src/types.ts` no contiene:
    - `RuntimeExtensionAPI`
    - `GoalRuntimeContext`
    - `sessionManager`
    - `modelRegistry`
    - `sendUserMessage`
  - Verificar que `@earendil-works/pi-ai/compat` aparece solo en `src/evaluator-adapter.ts`.
  - Verificar que `src/next-action.ts` no importa `tools.ts`.
  - Verificar que policy files no importan adapters ni runtime orquestador.

- [ ] **Step 2 — Completion safety tests**
  - Añadir/confirmar tests en `tests/next-action.test.ts`:
    - `met=true + blockers` no completa.
    - `met=true + missing evidence` no completa.
    - `met=true + pending current` no completa.
    - `met=true + valid evidence` completa.
  - Objetivo: el evaluator nunca completa por sí solo; `completion-policy.ts` conserva la última palabra.

- [ ] **Step 3 — Error classification hardening tests**
  - Ampliar tests de `classifyGoalRuntimeError(...)` con:
    - `AbortError` → retryable.
    - `TimeoutError` → retryable.
    - `rate limit` → retryable.
    - `overload` → retryable.
    - `temporary unavailable` → retryable.
    - `invalid api key` → non-retryable.
    - `bad request` → non-retryable.
    - `auth failed` → non-retryable.
  - Cambiar regex solo si algún caso esperado falla.

- [ ] **Step 4 — Adapter error propagation contract**
  - Añadir test en `tests/evaluator-adapter.test.ts`:
    - si `@earendil-works/pi-ai/compat.complete` rechaza, `completeGoalEvaluation(...)` rechaza con el mismo error.
  - Objetivo: que `runtime.ts` pueda clasificar el error original.

- [ ] **Step 5 — Minimal GoalState invariant validator**
  - Crear `src/state-invariants.ts` con función pura:
    - `validateGoalStateInvariant(goal): { ok: true } | { ok: false; reason: string }`
  - Invariantes mínimos:
    - `goalId` no vacío.
    - `evaluationTurns >= 0`.
    - `usage.total >= 0`.
    - `complete` no debe tener `continuationPendingAt`.
    - `paused` no debe tener `continuationPendingAt`.
    - `complete` no debe tener blockers activos.
  - Agregar tests directos.
  - Usarla solo en puntos críticos después de transiciones persistidas:
    - complete.
    - pause.
    - continuation pending.
    - evaluation.
  - Si falla, pausar/notificar de forma segura sin intentar continuar.

- [ ] **Step 6 — Confirm persistence before continuation send**
  - Cambiar `GoalContinuationStore.markPending(...)` para devolver `boolean`.
  - `createPiContinuationPorts(...).store.markPending(...)` devuelve `true` solo si `saveGoalState(...)` devuelve estado.
  - `queueGoalContinuation(...)` debe:
    - marcar guard.
    - intentar persistir pending.
    - si persistencia falla: limpiar guard, notificar warning, no enviar mensaje, devolver `false`.
    - si persistencia ok: enviar immediate/followUp como hoy.
  - Agregar test:
    - `markPending=false` no llama `queue.send` y devuelve `false`.

- [ ] **Step 7 — Runtime null-safety tests**
  - Añadir tests baratos para helpers:
    - `shouldResumeGoalAfterCompaction(null, ...)` → false.
    - `shouldResumeGoalAfterSessionStart(null, ...)` → false.
    - `shouldRetryPendingContinuation(null, ...)` → false.
    - `filterGoalContextMessages(messages, null)` elimina goal contexts.

- [ ] **Step 8 — Validation**
  - Ejecutar:
    - `npm run typecheck`
    - `npm test`
    - `lsp_diagnostics` en archivos modificados/nuevos.
    - `lens_diagnostics mode=delta severity=all`
    - `git diff --check`
  - Verificar boundary grep:
    - `types.ts` limpio de runtime/Pi.
    - `@earendil-works/pi-ai/compat` solo en adapter.
    - policies sin imports de infra.
  - Ejecutar `pi install .`.
  - Sincronizar `C:/Users/c___h/.pi/agent/settings.json` → `C:/dev/pi/my-pi-cli/agent/settings.json`.

## Verification

- [ ] `cd C:/dev/pi/T50-Systems/pi-thread-goal && npm run typecheck`
- [ ] `cd C:/dev/pi/T50-Systems/pi-thread-goal && npm test`
- [ ] `lsp_diagnostics` sobre archivos modificados/nuevos.
- [ ] `lens_diagnostics mode=delta severity=all`
- [ ] `git diff --check`
- [ ] Boundary grep manual.
- [ ] `pi install .`
- [ ] Settings sync.

## Critical points to preserve

- No cambiar comportamiento observable del goal runtime.
- No cambiar prompts.
- No tocar core `pi-coding-agent`.
- Mantener `mark pending → send message` como orden obligatorio.
- Mantener retryable errors reanudando en vez de congelar.
- Mantener completion condicionado a `validateGoalCompletion(...)`.

## Expected outcome

El runtime queda más endurecido y verificable con cambios mínimos:

- Boundaries protegidos por tests.
- Completion falso prevenido.
- Continuation no se envía si no se pudo persistir pending.
- Provider errors se propagan y clasifican correctamente.
- Estados imposibles detectados temprano.
- Null-safety cubierta en helpers críticos.
