# Goal Continuation Hardening Plan

## Context

`/goal` already injects active-goal context, evaluates completion after agent turns, and queues automatic continuation when the goal remains unmet. Recent failures show two separate hardening needs:

1. prevent agents from treating a completed sub-block plus a status summary as a valid stopping point for ongoing batch goals;
2. make automatic continuation delivery more observable and robust when a queued continuation does not start a new agent turn.

This plan turns prompt-level guidance into runtime-verifiable behavior.

## Goals

- Make checkpoint/status-only stops invalid when an active goal remains unmet and there is useful work available.
- Reserve `Blocked` for real operational blockers, not technical risk or actionable uncertainty.
- Improve continuation retry diagnostics and fallback behavior.
- Add regression coverage for semantic continuation and delivery retries.

## Non-goals

- Do not remove existing safety limits for runaway continuation.
- Do not force continuation when the goal is complete, verification is unrecoverably failing, a user decision is required, token budget is exhausted, or the turn limit is reached.
- Do not add a full planner or multi-goal queue.

## Phase 1 — Runtime guardrail for checkpoint-only stops

### Implementation

- Add policy helpers in `src/policies.ts`:
  - `isCheckpointOnlyStop(text: string): boolean`
  - `buildContinuationReason(goal, decision, agentText): string`
- Detect status/checkpoint-only language such as:
  - subtask completed + tests/build OK + roadmap remains;
  - “no marqué el goal como completo”; 
  - “quedan pendientes”; 
  - “resumen”; 
  - “siguiente pendiente”.
- In `src/runtime-mode-handlers.ts`, after evaluator returns `met=false`, use the helper to strengthen the continuation reason:
  - `Previous turn was checkpoint-only while goal remains unmet; continue with the next unfinished item.`
- Keep existing pause/complete/token/turn-limit decisions authoritative.

### Success criteria

- An unmet active goal with a checkpoint-only final response queues continuation.
- The continuation reason explicitly names the checkpoint-only stop.
- Existing complete/pause paths are unchanged.

## Phase 2 — Blocker classification hardening

### Implementation

- Add blocker classification in `src/policies.ts`:
  - `classifyProgressBlocker(text): "operational" | "risk" | "uncertainty"`
  - `hasOnlyNonOperationalBlockers(blocked: string[]): boolean`
- Treat examples like “likely needs HarfBuzz/shaping engine” as risk/actionable uncertainty, not operational blockage.
- Update `update_goal_progress` behavior in `src/tools.ts`:
  - either warn in `details` when `blocked` contains likely non-operational blockers;
  - or normalize guidance so the model should move those entries to `summary/current`.
- Keep true blockers valid, e.g. “waiting for user decision”, “missing credentials”, “external API unavailable with no offline path”.

### Success criteria

- Technical risk is not treated as a legitimate reason to stop an ongoing goal.
- Real user/runtime/external blockers remain supported.
- Tests cover both categories.

## Phase 3 — Continuation delivery robustness

### Implementation

- Enhance continuation diagnostics in `src/continuation.ts` and `src/runtime-actions.ts`:
  - attempted mode: `immediate` or `followUp`;
  - idle state;
  - pending-message state;
  - attempt number;
  - last sent/started timestamps;
  - stale reason.
- Alternate delivery strategy on retries:
  - attempt 1: current mode selection;
  - attempt 2: fallback to `followUp` if immediate did not start;
  - attempt 3: fallback to `immediate` if follow-up did not start.
- Distinguish “sendUserMessage threw” from “send succeeded but no agent turn started”.
- Improve pause message after exhausted attempts:
  - say the continuation delivery did not start a new turn;
  - recommend `/goal doctor` and `/goal resume`.

### Success criteria

- Retry events expose enough state to diagnose why continuation did not start.
- Delivery retries use at least one fallback mode before pausing.
- Exhaustion pause message is specific and actionable.

## Phase 4 — Regression tests

### Test files

- `tests/prompts.test.ts`
- `tests/tools.test.ts`
- `tests/continuation.test.ts`
- `tests/runtime-mode-handlers.test.ts`

### Required cases

1. **Checkpoint-only unmet turn continues**
   - Given active batch goal.
   - Agent final text is a status summary after one sub-block.
   - Evaluator returns `met=false`.
   - Runtime queues continuation with checkpoint-specific reason.

2. **Technical risk is not operational blocker**
   - `blocked: ["Full complex-script/ZWJ shaping likely needs HarfBuzz"]`.
   - Classifier tags it as risk/uncertainty.
   - The continuation path remains available.

3. **Real blocker remains valid**
   - `blocked: ["waiting for user decision on shaping engine dependency"]`.
   - Classifier tags it as operational.

4. **Retry fallback behavior**
   - Simulate stale pending continuation.
   - Verify retry attempts switch delivery modes before pausing.

5. **Pause only after exhausted delivery attempts**
   - Simulate three stale retries.
   - Verify goal pauses with clear diagnostic message.

## Phase 5 — Verification

Run:

```bash
npm run lint
npm run typecheck
npm test
```

Optional live/manual check:

```text
/goal doctor
/goal resume
```

Then use a batch-style roadmap goal and intentionally produce an intermediate status summary. The expected behavior is that `/goal` continues automatically instead of treating the summary as a stopping point.

## Implementation order

1. Implement Phase 1 and its tests.
2. Implement Phase 2 and its tests.
3. Implement Phase 3 and its tests.
4. Run the full verification suite.
5. Run one manual `/goal resume` smoke test in a real session.

## Risks

- Over-aggressive checkpoint detection could continue when the user expected a pause. Mitigation: keep hard stop conditions explicit and authoritative.
- Blocker classification can be heuristic. Mitigation: warn and guide first; avoid destructive normalization until behavior is proven.
- Delivery fallback depends on Pi host semantics for `sendUserMessage`. Mitigation: isolate mode-selection logic behind tested policy helpers.
