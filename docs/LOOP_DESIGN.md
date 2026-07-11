# Companion `/loop` Design

## Purpose

`/goal` is completion-driven: it evaluates work after each turn and continues until a condition is met. `/loop` is time-driven: it schedules work after an interval. These semantics should remain separate.

## Proposed package boundary

A future companion package should own:

- interval parsing and validation;
- scheduling, cancellation, and wake-up behavior;
- missed-run and overlapping-run policy;
- persisted schedule state and next-run diagnostics;
- explicit user controls such as `/loop status`, `/loop pause`, and `/loop cancel`.

`pi-thread-goal` should continue to own:

- goal objective and acceptance criteria;
- per-turn completion evaluation;
- branch-local goal progress and completion state;
- automatic continuation immediately after an unmet turn.

## Shared primitives

The packages may share small, host-facing primitives for:

- custom session-entry persistence;
- branch-aware replay;
- status/widget formatting conventions;
- bounded retries and actionable diagnostics.

They should not share a combined state machine. A scheduled loop may start or resume a goal through public commands, but `/goal` must not acquire timers and `/loop` must not decide semantic completion.

## Safety rules

- Require explicit intervals and impose a minimum supported interval.
- Prevent overlapping runs by default.
- Bound missed-run catch-up; never replay an unbounded backlog.
- Pause after repeated delivery failures and surface a recovery action.
- Preserve branch/session ownership so a schedule cannot mutate an unrelated branch.
- Do not introduce a detached background process without a separate architecture and lifecycle decision.

## Implementation sequence

1. Validate current Pi support for alarms, timers, or durable scheduling.
2. Define schedule event/state contracts in the companion package.
3. Implement parse/status/pause/cancel without execution side effects.
4. Add one-shot wake-up delivery with overlap protection.
5. Add persistence/restart tests and failure recovery.
6. Integrate optionally with `/goal` through public commands only.
