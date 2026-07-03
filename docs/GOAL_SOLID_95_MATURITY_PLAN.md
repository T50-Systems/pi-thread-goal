# Goal Runtime SOLID 9.5 Maturity Plan

## Context

El código de `pi-thread-goal` ya está en una madurez SOLID media-alta (~7.6/10): dominio separado, policies puras, adapters aislados, tests de boundaries e invariantes mínimos. Para subirlo hacia ~9.5/10, el siguiente salto debe concentrarse en los puntos menos maduros sin agregar features:

- `runtime.ts` todavía concentra demasiados modos y transiciones.
- `state.ts` mezcla reducer, snapshot parsing, load/save y validación de objetivo.
- `evaluator.ts` depende directamente del adapter concreto en vez de un provider port.
- `continuation.ts` combina application service, ports y factory Pi.
- Algunos contratos de runtime aún son amplios (`GoalRuntimeContext`) y podrían pasarse como capabilities más pequeñas.

El objetivo es mejorar SOLID, testabilidad y mantenibilidad, preservando comportamiento observable.

## Target maturity

- SRP: 9.5 — módulos con una responsabilidad dominante.
- OCP: 9 — agregar modos/adapters/providers con menos cambios concentrados.
- LSP: 9.5 — ports sustituibles con contratos explícitos y tests.
- ISP: 9.5 — context/capabilities pequeños por consumidor.
- DIP: 9.5 — application services dependen de ports, no adapters concretos.

## Non-goals

- No agregar features.
- No cambiar prompts.
- No tocar core `pi-coding-agent`.
- No cambiar comportamiento de continuation/watchdog/evaluator.
- No introducir frameworks, DI containers o plugin systems pesados.
- No reescribir todo; hacerlo por slices reversibles.

## Approach

Ejecutar refactor por slices pequeños y verificables:

1. Extraer ports runtime/evaluator/state a módulos dedicados.
2. Separar `state.ts` en reducer/snapshot/store facade manteniendo API pública compatible.
3. Separar mode handlers desde `runtime.ts`.
4. Hacer `evaluator.ts` depender de un `GoalEvaluatorProvider` port.
5. Mover factories Pi a adapters/composition.
6. Reducir interfaces amplias usando capability subsets.
7. Añadir peer/boundary tests para blindar la nueva arquitectura.

## Files to modify

Likely new files:

- `src/goal-state-reducer.ts`
- `src/goal-state-snapshot.ts`
- `src/goal-state-store.ts`
- `src/goal-runtime-ports.ts`
- `src/evaluator-provider.ts`
- `src/pi-evaluator-provider.ts`
- `src/pi-continuation-ports.ts`
- `src/runtime-mode-handlers.ts`
- `src/runtime-actions.ts`
- `src/runtime-guards.ts`

Existing files:

- `src/state.ts`
- `src/runtime.ts`
- `src/evaluator.ts`
- `src/evaluator-adapter.ts`
- `src/continuation.ts`
- `src/runtime-types.ts`
- tests under `tests/`.

## Reuse

- Keep public exports from `src/state.ts` for compatibility, but delegate internally to split modules.
- Keep `completeGoalEvaluation(...)` behavior, but move concrete provider binding behind a provider port.
- Keep `queueGoalContinuation(...)` behavior, but move Pi-specific factory out of `continuation.ts`.
- Keep all existing tests and add architectural tests.

## Steps

- [ ] **Step 1 — Define runtime/application ports**
  - Create `src/goal-runtime-ports.ts` with small capability ports:
    - `GoalStateStore`
    - `GoalMessageQueue`
    - `GoalNotifier`
    - `GoalRuntimeIdleProbe`
    - `GoalEvaluatorProvider`
  - Ensure ports do not import Pi concrete APIs.
  - Update boundary tests to enforce ports remain adapter-free.

- [ ] **Step 2 — Split state responsibilities behind compatible facade**
  - Create `src/goal-state-reducer.ts`:
    - `createGoalState(...)`
    - `reduceGoalState(...)`
    - objective/progress normalization helpers.
  - Create `src/goal-state-snapshot.ts`:
    - `createGoalStateSnapshot(...)`
    - parsing/clone helpers.
  - Create `src/goal-state-store.ts`:
    - `saveGoalState(...)`
    - `loadGoalState(...)`
    - branch append/load adapter-facing contracts.
  - Keep `src/state.ts` as a compatibility facade re-exporting the same API.
  - Move tests or add focused tests per split module.

- [ ] **Step 3 — Move Pi continuation factory out of application service**
  - Move `createPiContinuationPorts(...)` from `src/continuation.ts` to `src/pi-continuation-ports.ts`.
  - `src/continuation.ts` should only contain application service logic + port types or imported port types.
  - Runtime imports Pi factory from adapter module.
  - Boundary test: `continuation.ts` must not import `saveGoalState` or runtime Pi types directly.

- [ ] **Step 4 — Introduce evaluator provider port**
  - Create `src/evaluator-provider.ts` with:
    - `EvaluatorMessage`
    - `EvaluatorResponse`
    - `GoalEvaluatorProvider`
  - Move provider implementation to `src/pi-evaluator-provider.ts`, using `completeGoalEvaluation(...)` / `@earendil-works/pi-ai/compat` adapter.
  - Refactor `evaluateGoal(...)` to accept a provider dependency, with default factory only at composition/runtime boundary if needed.
  - Existing behavior must remain identical.
  - Tests should inject fake provider, avoiding module-level mocks where possible.

- [ ] **Step 5 — Extract runtime action handlers**
  - Create `src/runtime-actions.ts` with application-level actions:
    - `applyGoalAction(...)`
    - `pauseGoal(...)`
    - invariant enforcement helper.
  - `runtime.ts` should delegate action application after `decideGoalNextAction(...)`.
  - Keep side effects explicit through services/ports argument.

- [ ] **Step 6 — Extract runtime mode handlers**
  - Create `src/runtime-mode-handlers.ts` for event mode handlers:
    - `handleBeforeAgentStart(...)`
    - `handleContext(...)`
    - `handleSessionBeforeCompact(...)`
    - `handleSessionCompact(...)`
    - `handleSessionStart(...)`
    - `handleSessionTree(...)`
    - `handleAgentEnd(...)`
  - `runtime.ts` becomes composition root + hook registration only.
  - Preserve `evaluatingGoalId`/continuation guard semantics.

- [ ] **Step 7 — Extract runtime guards/policies**
  - Create `src/runtime-guards.ts` for:
    - `filterGoalContextMessages(...)`
    - `shouldResumeGoalAfterCompaction(...)`
    - helper guards currently in `runtime.ts`.
  - Keep pure, adapter-free, directly unit-tested.

- [ ] **Step 8 — Reduce broad context usage via capabilities**
  - Where possible, replace full `GoalRuntimeContext` parameters with smaller capability subsets:
    - idle probe only where only `isIdle/hasPendingMessages` are needed.
    - notifier only where only UI notify is needed.
    - evaluator context only where model/modelRegistry/signal are needed.
  - Keep `runtime-types.ts` as Pi runtime contract, but application services consume narrower ports.

- [ ] **Step 9 — Architecture/boundary tests for SOLID 9.5**
  - Extend `tests/boundaries.test.ts`:
    - `runtime.ts` imports mode handlers, not evaluator adapter/provider internals.
    - pure policy/guard modules import no adapters/runtime Pi modules.
    - adapter modules are the only modules importing concrete Pi infra/dynamic compat.
    - application service modules depend on ports, not concrete adapters.
    - `state.ts` is only facade/re-export and does not re-accumulate reducer/parser/store logic.

- [ ] **Step 10 — Regression and behavior tests**
  - Keep all existing tests passing.
  - Add focused tests for new modules if coverage moved:
    - reducer transitions.
    - snapshot parsing/filtering.
    - store save/load facade compatibility.
    - runtime mode handler behavior.
    - evaluator provider injection behavior.
  - Avoid duplicating broad integration tests unless a split creates risk.

- [ ] **Step 11 — SOLID maturity checklist**
  - Verify:
    - `runtime.ts` is composition root/hook registration only.
    - `state.ts` is compatibility facade only.
    - application services import ports, not adapters.
    - policies/guards are pure.
    - adapters are isolated.
    - each module has one clear reason to change.
  - Document final boundary map in `docs/GOAL_SOLID_BOUNDARY_MAP.md`.

- [ ] **Step 12 — Validation**
  - Run:
    - `npm run typecheck`
    - `npm test`
    - `lsp_diagnostics` on modified/new files.
    - `lens_diagnostics mode=delta severity=all`
    - `git diff --check`
    - boundary grep/manual architecture checks.
    - `pi install .`
    - sync `C:/Users/c___h/.pi/agent/settings.json` → `C:/dev/pi/my-pi-cli/agent/settings.json`.

## Acceptance criteria

- Behavior unchanged for:
  - evaluator completion/continuation/pause.
  - retryable errors.
  - continuation pending/watchdog.
  - compaction resume.
  - context injection/filtering.
  - completion validation.
- All current tests pass and new tests pass.
- `runtime.ts` no longer contains dense business flow; it registers hooks and delegates.
- `state.ts` no longer owns reducer + snapshot + store logic directly; it is a facade.
- `evaluator.ts` depends on provider port, not concrete Pi AI adapter.
- `continuation.ts` contains no Pi-specific persistence/message adapter code.
- Boundary tests enforce the new structure.

## Risks and mitigations

- **Risk:** Over-abstraction.
  - **Mitigation:** Only introduce ports where code already has real external dependencies or tests need substitution.
- **Risk:** Import cycles after splitting `state.ts`.
  - **Mitigation:** Keep domain types as leaf, reducer independent from store, snapshot independent from runtime.
- **Risk:** Runtime semantics drift.
  - **Mitigation:** Move code first, then refactor signatures; keep tests green after each slice.
- **Risk:** Too many files for a small package.
  - **Mitigation:** Stop if a split does not reduce a concrete SOLID smell.

## Expected outcome

Approximate SOLID maturity after plan:

- SRP: 9.5
- OCP: 9
- LSP: 9.5
- ISP: 9.5
- DIP: 9.5

The runtime becomes a lean composition root, state logic is decomposed, application services depend on ports, adapters are isolated, and boundary tests prevent architectural regression.
