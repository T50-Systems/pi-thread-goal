# Architecture and Module Boundaries

This document maps the internal architecture of `pi-thread-goal`. It captures the main components, data flow, and extension points to help contributors make safe changes.

## Core concepts

- **Branch-aware state:** Goal state is not a single file on disk. It is event-sourced from Pi session entries (`appendEntry`) and reconstructed dynamically from the active branch using `getBranch()`.
- **Guarded mutations:** The model cannot complete a goal randomly. It must observe the state (`get_goal`), prepare a completion candidate (`prepare_goal_completion`), and complete it (`complete_goal`) with the exact same evidence.
- **Automatic continuation:** If a turn ends without the goal being completed, the extension intercepts the hook, evaluates the state, and queues a continuation prompt automatically.

## Module boundaries

The `src/` directory is split into cohesive modules that enforce separation of concerns:

### 1. State and Persistence
- **`types.ts`:** Canonical interfaces for `GoalState`, `GoalProgress`, and internal event types.
- **`goal-state.ts`:** Pure functions for event-sourcing and reconstructing the goal state machine.
- **`goal-state-persistence.ts`:** Impure adapters to load from and save to Pi's `SessionManager`.
- **`goal-operations.ts`:** Domain operations (create, pause, complete, progress) that mutate state and append entries.

### 2. Protocol and Tools
- **`goal-protocol.ts`:** Capability tokens and authorization policies that prevent stale or duplicate mutations.
- **`tools.ts`:** Registration of the 5 model tools (`get_goal`, `update_goal_progress`, etc.).
- **`prompts.ts`:** Pure template renderers for context injection, start, continuation, and evaluation prompts.

### 3. Runtime and Orchestration
- **`runtime.ts` / `runtime-actions.ts` / `runtime-mode-handlers.ts`:** Orchestration of the Pi extension hooks (`onSessionStart`, `onTurnStart`, `onTurnEnd`). Determines whether a goal is active, should continue, or needs evaluator intervention.
- **`continuation.ts`:** The delivery watchdog. Tracks queued, sent, and failed continuation phases, handling backoff and retries.
- **`evaluator.ts`:** Turn-end evaluation logic that uses a separate LLM call to decide if the goal objective is met independently of the primary model's tools.
- **`policies.ts`:** Pure business rules (e.g., max automatic turns, rate limits) preventing runaway loops.

### 4. User Interface
- **`commands.ts`:** Slash-command parsing (`/goal start`, `/goal doctor`, `/goal edit`) and user intents.
- **`ui.ts`:** Formatting for the compact status widget, overlay UI, and terminal output.

## Control flow

### Normal execution loop
1. **Turn Start:** `runtime.ts` intercepts `onTurnStart`. If a goal is active, it injects the hidden context prompt.
2. **Model Execution:** The model reads the context, does work, and optionally calls `update_goal_progress`.
3. **Mutation:** Tools validate authorization via `goal-protocol.ts` before modifying state in `goal-state-persistence.ts`.
4. **Turn End:** `runtime.ts` intercepts `onTurnEnd`.
   - If the goal completed, it stops cleanly.
   - If the goal is still unmet, it calls `evaluator.ts`.
5. **Evaluation:** The evaluator checks the condition. If unmet, `continuation.ts` queues a continuation prompt.
6. **Continuation:** Pi fires the queued prompt, starting a new turn (loop back to step 1).

## Extension points

- **Evaluator models:** The evaluator automatically uses Pi's configured model or falls back to a fast model. This can be customized by extending `GoalEvaluatorProvider`.
- **Commands:** New commands can be added to `commands.ts` by registering new patterns in the main command handler.
- **UI Renderers:** `ui.ts` provides hooks to render rich TUI components; adding new views (like history graphs) hooks into this layer.
