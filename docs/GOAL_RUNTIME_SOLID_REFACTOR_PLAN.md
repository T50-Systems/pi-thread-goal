# Goal Runtime SOLID/Clean Code Refactor Plan

## Context

`src/runtime.ts` concentra demasiadas responsabilidades: integración con hooks de Pi, manejo de continuidad automática, watchdog de continuaciones pendientes, evaluación LLM, clasificación de errores, límites de presupuesto/turnos, acciones de pausa/completado y utilidades de mensajes. Los hardenings recientes funcionaron y están validados, pero dejaron el módulo más difícil de razonar y de testear aisladamente.

El objetivo de este refactor es preservar exactamente el comportamiento endurecido actual mientras se separan responsabilidades, se reducen dependencias implícitas y se eliminan diffs ruidosos por line endings.

## Approach

Refactorizar por slices pequeños y verificables, sin cambiar semántica externa de `/goal`:

1. Extraer control de continuación a un módulo puro/pequeño.
2. Extraer evaluación del goal a un módulo dedicado.
3. Extraer política de siguiente acción del `agent_end` a funciones puras.
4. Normalizar line endings con `.gitattributes`.
5. Hacer configurable el timeout del evaluador, con fallback actual de `45_000ms`.

`src/runtime.ts` debe quedar como orquestador de hooks: cargar estado, llamar servicios/políticas, persistir eventos y aplicar UI.

## Files to modify

- `src/runtime.ts`
- `src/types.ts`
- `src/continuation.ts` *(nuevo)*
- `src/evaluator.ts` *(nuevo)*
- `src/next-action.ts` *(nuevo)*
- `tests/runtime.test.ts`
- `tests/continuation.test.ts` *(nuevo)*
- `tests/evaluator.test.ts` *(nuevo)*
- `tests/next-action.test.ts` *(nuevo)*
- `.gitattributes` *(nuevo)*
- Opcional: `README.md` o `docs/` si se documenta el timeout configurable.

## Reuse

- `renderGoalContinuationPrompt(...)` en `src/prompts.ts` para mantener prompts existentes.
- `renderGoalEvaluationPrompt(...)` en `src/prompts.ts` para el evaluador.
- `loadGoalState(...)` / `saveGoalState(...)` en `src/state.ts` para persistencia branch-aware.
- `validateGoalCompletion(...)` en `src/tools.ts` para evitar completar batch goals prematuramente.
- `applyGoalUi(...)` en `src/ui.ts` para mantener UI centralizada.
- Constantes/comportamientos actuales en `src/runtime.ts`:
  - `MAX_AUTOMATIC_CONTINUATION_TURNS = 25`
  - watchdog actual de `30_000ms`
  - timeout actual de `45_000ms`
  - clasificación retryable de `abort|cancel|compact|retry|timeout|temporary|rate limit|overload`

## Steps

- [ ] **Slice 1 — Tipos compartidos de runtime**
  - Mover/exportar interfaces que hoy están privadas en `runtime.ts` pero serán compartidas: contexto mínimo de runtime, API mínima para enqueue, eventos `SessionStartEvent`, `CompactionResumeEvent`, `AgentEndEvent` si hace falta.
  - Mantener los tipos estrechos; no introducir dependencia directa del tipo completo de Pi si no es necesario.

- [ ] **Slice 2 — Extraer continuación a `src/continuation.ts`**
  - Mover:
    - `ContinuationGuardState`
    - `CONTINUATION_WATCHDOG_MS`
    - `shouldQueueGoalContinuation(...)`
    - `clearQueuedGoalContinuation(...)`
    - `shouldRetryPendingContinuation(...)`
    - `queueGoalContinuation(...)`
  - Mantener la persistencia de `continuationPendingAt` antes de `sendUserMessage(...)`.
  - Mantener `try/catch` alrededor de `sendUserMessage(...)`.
  - Añadir/trasladar tests desde `runtime.test.ts` a `continuation.test.ts`.

- [ ] **Slice 3 — Extraer evaluador a `src/evaluator.ts`**
  - Mover:
    - `PI_AI_COMPAT_MODULE`
    - dynamic import de `@earendil-works/pi-ai/compat`
    - `EVALUATOR_SYSTEM_PROMPT`
    - `EVALUATOR_TIMEOUT_MS`
    - `withTimeout(...)`
    - `evaluateGoal(...)`
    - `pickEvaluatorModel(...)`
    - `parseEvaluatorDecision(...)`
    - `classifyGoalRuntimeError(...)`
  - Exponer una API pequeña:
    - `evaluateGoal(goal, ctx, options?)`
    - `classifyGoalRuntimeError(error)`
  - Conservar dynamic import para no reintroducir problemas con package exports.
  - Añadir tests unitarios para parseo JSON, timeout retryable y auth/model unavailable.

- [ ] **Slice 4 — Hacer configurable el timeout**
  - Añadir soporte opcional en contexto/config para timeout del evaluador sin romper estado existente.
  - Recomendación mínima: `GOAL_EVALUATOR_TIMEOUT_MS` vía `process.env`, validado como entero positivo, fallback a `45_000`.
  - Documentar el fallback y validar que valores inválidos no rompen el evaluador.

- [ ] **Slice 5 — Extraer política de siguiente acción a `src/next-action.ts`**
  - Crear una función pura tipo `decideGoalNextAction(...)` que reciba goal evaluado, decisión del evaluador, reason/usage y devuelva una acción discriminada:
    - `complete`
    - `pause-error`
    - `pause-token-budget`
    - `pause-turn-limit`
    - `continue`
  - Mover o envolver:
    - `hasReachedAutomaticContinuationLimit(...)`
    - `hasReachedTokenBudget(...)`
    - `shouldPauseForEvaluatorConfiguration(...)`
  - `runtime.ts` debe persistir/aplicar UI según la acción, pero no decidir internamente todas las ramas.
  - Añadir tests exhaustivos por acción.

- [ ] **Slice 6 — Reducir `runtime.ts` a orquestador**
  - Reemplazar helpers inline por imports.
  - Mantener hooks actuales:
    - `before_agent_start`
    - `context`
    - `session_before_compact`
    - `session_compact`
    - `session_start`
    - `session_tree`
    - `agent_end`
  - Verificar que no cambian prompts ni condiciones de idleness/pending messages.

- [ ] **Slice 7 — Normalizar line endings**
  - Añadir `.gitattributes` con reglas conservadoras:
    - `* text=auto`
    - `*.ts text eol=lf`
    - `*.tsx text eol=lf`
    - `*.js text eol=lf`
    - `*.json text eol=lf`
    - `*.md text eol=lf`
  - Revisar `git diff --check`.
  - Evitar reformateos masivos no relacionados.

- [ ] **Slice 8 — Actualizar tests/imports**
  - Mover tests puros fuera de `runtime.test.ts`.
  - Mantener tests de integración ligera de hooks en `runtime.test.ts` solo para cableado principal.
  - Asegurar que los tests nuevos cubren watchdog, timeout, error retryable y política de pausa/continuación.

## Verification

- [ ] `cd C:/dev/pi/T50-Systems/pi-thread-goal && npm run typecheck`
- [ ] `cd C:/dev/pi/T50-Systems/pi-thread-goal && npm test`
- [ ] `lsp_diagnostics` sobre:
  - `src/runtime.ts`
  - `src/continuation.ts`
  - `src/evaluator.ts`
  - `src/next-action.ts`
  - tests nuevos/modificados
- [ ] `lens_diagnostics mode=delta severity=all`
- [ ] `git diff --check`
- [ ] Revisión semántica de diff para confirmar que no cambian:
  - condiciones de idle/pending messages
  - watchdog de `continuationPendingAt`
  - timeout default de `45_000ms`
  - errores retryable
  - límites de token/turnos
  - validación de completion para batch goals
- [ ] `pi install .`
- [ ] Sincronizar `C:/Users/c___h/.pi/agent/settings.json` → `C:/dev/pi/my-pi-cli/agent/settings.json`

## Risks and mitigations

- **Riesgo:** cambiar comportamiento mientras se mueven funciones.
  - **Mitigación:** extraer primero con tests existentes en verde; no rediseñar condiciones en el mismo slice.
- **Riesgo:** cyclic imports entre `runtime`, `continuation`, `evaluator` y `types`.
  - **Mitigación:** poner tipos compartidos en `types.ts` o en módulos leaf sin imports de `runtime.ts`.
- **Riesgo:** `.gitattributes` produzca diff grande por line endings.
  - **Mitigación:** añadir regla primero, luego revisar `git diff --check`; evitar renormalizar archivos no tocados salvo que sea explícitamente necesario.
- **Riesgo:** timeout configurable mal parseado.
  - **Mitigación:** helper puro con tests: acepta entero positivo, ignora valores inválidos y conserva fallback.
