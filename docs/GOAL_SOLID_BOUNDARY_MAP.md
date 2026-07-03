# Goal Runtime SOLID Boundary Map

## Composition root

- `src/runtime.ts`
  - Registers Pi hooks.
  - Owns runtime-level lock and continuation guard instances.
  - Delegates all hook bodies to `runtime-mode-handlers.ts`.

## Runtime mode handlers

- `src/runtime-mode-handlers.ts`
  - Handles Pi lifecycle modes:
    - `before_agent_start`
    - `context`
    - `session_before_compact`
    - `session_compact`
    - `session_start`
    - `session_tree`
    - `agent_end`
  - Coordinates application services, guards, state store facade and UI projection.

## Runtime actions

- `src/runtime-actions.ts`
  - Applies `GoalNextAction` values:
    - complete
    - pause
    - continue
  - Handles retryable/non-retryable evaluator errors.
  - Handles pending-continuation retry.
  - Enforces state invariants after critical persisted transitions.

## Runtime guards / pure runtime policies

- `src/runtime-guards.ts`
  - Filters goal context messages.
  - Decides whether compaction should resume a goal.
  - No adapters or external Pi calls.

## Domain types

- `src/types.ts`
  - Domain state and events only.
  - No Pi runtime/API contracts.

## Runtime contracts

- `src/runtime-types.ts`
  - Pi/runtime event and context contracts.
  - Kept separate from domain types.

## Application ports

- `src/goal-runtime-ports.ts`
  - Small substitutable capabilities:
    - `GoalStateStore`
    - `GoalMessageQueue`
    - `GoalNotifier`
    - `GoalRuntimeIdleProbe`
    - `GoalEvaluatorProvider`

## State boundary

- `src/goal-state-reducer.ts`
  - Creates and reduces `GoalState` from `GoalEvent`.
  - Owns objective/progress normalization.

- `src/goal-state-snapshot.ts`
  - Parses branch entries into `GoalStateSnapshot`.
  - Owns cloning and snapshot reconstruction.

- `src/goal-state-store.ts`
  - Adapter-facing load/save facade over Pi branch append/load capabilities.

- `src/state.ts`
  - Compatibility facade only.

## Pure policies

- `src/completion-policy.ts`
  - Validates completion safety.

- `src/next-action.ts`
  - Converts `GoalState + EvaluatorDecision` into `GoalNextAction`.

- `src/evaluator-policy.ts`
  - Parses evaluator JSON, resolves timeout and classifies runtime errors.

- `src/state-invariants.ts`
  - Validates minimal `GoalState` invariants.

## Evaluator boundary

- `src/evaluator.ts`
  - Application service for goal evaluation.
  - Consumes `GoalEvaluatorProvider` via options.
  - Defaults to Pi provider for runtime compatibility.

- `src/evaluator-provider.ts`
  - Provider contract re-exports.

- `src/pi-evaluator-provider.ts`
  - Concrete provider binding for Pi AI.

- `src/evaluator-adapter.ts`
  - Only module that imports `@earendil-works/pi-ai/compat`.

## Continuation boundary

- `src/continuation.ts`
  - Application service for continuation queueing and retry guards.
  - Depends on ports, not Pi concrete persistence/message APIs.

- `src/pi-continuation-ports.ts`
  - Concrete Pi adapters for state persistence, message queue and notifier.

## Usage collection

- `src/usage-collector.ts`
  - Sums assistant token usage from agent-end messages.
  - Keeps usage parsing outside runtime mode handlers.

## UI / prompts

- `src/ui.ts`
  - Goal UI projection.

- `src/prompts.ts`
  - Prompt/context rendering.

## Guardrails

- `tests/boundaries.test.ts`
  - Protects domain/runtime/policy/adapter boundaries.
  - Ensures `runtime.ts` remains a composition root.
  - Ensures `state.ts` remains a facade.
  - Ensures continuation application logic stays adapter-free.
