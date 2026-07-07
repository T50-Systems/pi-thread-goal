---
repository: pi-thread-goal
branch: main
commit: 5713cad
scope: working-tree goal protocol hardening
date: 2026-07-07T00:29:48-04:00
status: ready
blockers_count: 7
verification: 10 verified · 0 weakened · 0 falsified
---

# Goal Protocol Hardening Fragility Review

Review of the uncommitted working-tree changes that add Mealy-style goal protocol policies, observation/completion tokens, revision checks, runtime epoch resets, and tool schema changes.

## 🔴 Critical

### F10 — Stale async evaluator commits can append from a pre-await goal snapshot

`handleAgentEnd` loads the active goal, awaits model evaluation, then persists the evaluation using the old `latest` object rather than reloading and comparing revision/status after the await.

Evidence:

- `src/runtime-mode-handlers.ts:249` — `const latest = loadGoalState(runtimeCtx);`
- `src/runtime-mode-handlers.ts:252` — `const decision = await evaluateGoal(latest, runtimeCtx);`
- `src/runtime-mode-handlers.ts:258` — `const evaluated = saveGoalOperation(`
- `src/runtime-mode-handlers.ts:270` — `latest,`
- `src/goal-operation-workflow.ts:32` — `const after = reduceGoalStateMachine(input.before, input.event);`

Risk: if a tool/user/runtime mutation lands while `evaluateGoal()` is in flight, the operation contract verifies against stale `before` state. Replay may later reject or reinterpret the appended event against the real branch head, creating event/snapshot drift and making protocol tokens appear safer than the actual async mutation boundary.

Hardening direction: make runtime evaluation a compare-and-swap flow: reload after `await`, require same `goalId`, `status: active`, and `revision`, then append; otherwise drop/retry the evaluation.

## 🟡 Important

### F1 — Token registry is process-global, not scoped by session/branch/caller

Evidence:

- `src/goal-protocol-tokens.ts:93` — `export const defaultGoalProtocolTokens = new GoalProtocolTokenRegistry();`
- `src/goal-protocol-guards.ts:121` — `record.goalId === goal.goalId &&`
- `src/goal-protocol-guards.ts:124` — `record.epoch === epoch &&`

Risk: lifecycle reset in one runtime context can invalidate another context's in-flight token. Conversely, a token can authorize in another context if `goalId`, `revision`, `status`, and epoch line up. The UUID makes collision unlikely, but branch forks can intentionally share goal IDs/revisions.

Hardening direction: scope registries/tokens by session/branch/runtime context, and include that scope in token records and validation.

### F2 — `handleSessionTree` misses an epoch reset

Evidence:

- `src/runtime-mode-handlers.ts:212` — `export async function handleSessionTree(`
- `src/runtime-mode-handlers.ts:216` — `const goal = loadGoalState(runtimeCtx);`
- `src/runtime-mode-handlers.ts:218` — `retryPendingContinuation(runtimePi, runtimeCtx, continuationGuard, goal);`

Other lifecycle handlers reset epoch, but session-tree handling reloads branch state and retries continuation without resetting protocol tokens.

Hardening direction: call `resetGoalProtocolEpoch()` at the start of `handleSessionTree`, and add a reset-epoch regression test.

### F3 — Tool details leak full protocol token records

Evidence:

- `src/tools.ts:178` — `protocol: decision,`
- `src/goal-protocol-policy.ts:133` — `data: record,`
- `src/goal-protocol-tokens.ts:57` — `evidence,`

Risk: `prepare_goal_completion` returns the entire protocol decision, including the completion token record and plaintext evidence in `data`. That broadens bearer-token exposure beyond the minimal `completion_token` field.

Hardening direction: return a redacted protocol summary in tool details; never return token records or plaintext evidence in `protocol.data`.

### F4 — Bearer observation tokens are rendered as plain text

Evidence:

- `src/prompts.ts:16` — ``? `Observation token: ${escapeXml(observationToken)}```
- `src/tools.ts:304` — ``observationToken ? `Observation token: ${observationToken}` : undefined,``

Risk: tokens can be copied into conversation summaries or user-visible text. Even if epoch reset makes old tokens fail closed, the resulting failure mode is noisy and brittle.

Hardening direction: keep tokens in structured tool/runtime metadata where possible, or use opaque handles that are not preserved in natural-language summaries.

### F5 — Blank completion evidence can complete goals without acceptance criteria

Evidence:

- `src/tools.ts:37` — `evidence: Type.String({ description: "Completion evidence to validate." }),`
- `src/goal-protocol-policy.ts:126` — `const evidence = input.evidence?.trim() ?? "";`
- `src/completion-policy.ts:14` — `if (goal.acceptanceCriteria.length > 0 && !evidenceText) {`

Risk: prompts say completion requires evidence, but policy allows blank evidence when there are no acceptance criteria, no blockers, and no current work.

Hardening direction: require non-empty evidence for every completion candidate, regardless of acceptance criteria.

### F6 — No-op progress updates mutate state and invalidate tokens

Evidence:

- `src/tools.ts:56` — `done: Type.Optional(Type.Array(Type.String())),`
- `src/tools.ts:260` — `progress: normalizeProgressInput(params),`
- `src/goal-state-machine.ts:149` — `revision: nextRevision(current),`

Risk: `update_goal_progress({ observation_token })` appends a progress event, increments revision, and invalidates tokens without semantic progress.

Hardening direction: reject progress updates unless at least one progress field is present and materially changes the normalized progress state.

### F7 — Replay parser accepts partial events and ignores stored state

Evidence:

- `src/goal-state-snapshot.ts:37` — `current = reduceGoalState(current, goalEntry.event);`
- `src/goal-state-snapshot.ts:92` — `typeof value.action === "string" &&`
- `src/goal-state-snapshot.ts:93` — `typeof value.goalId === "string"`
- `src/goal-state-normalizers.ts:33` — `objective: validateObjective(event.objective),`

Risk: a legacy/migrated create entry with a valid stored state but an incomplete event can crash replay because reconstruction ignores `state` and replays the partial event.

Hardening direction: validate event shape per action before replay, or use a safe migration path that can recover from stored snapshots when events are incomplete.

## 🔵 Suggestions

### F8 — Replace invalidates the new goal ID, not the replaced goal ID

Evidence:

- `src/goal-operation-workflow.ts:49` — `invalidateGoalProtocolTokens(input.event.goalId);`
- `src/goal-command-handlers.ts:190` — `action: "replace" as const,`
- `src/goal-command-handlers.ts:191` — `goalId: randomUUID(),`

Risk: old-goal tokens remain resident until TTL. They will fail in the replaced branch because goal ID changes, but can remain valid in a forked context where the old goal still exists.

Hardening direction: invalidate both `before.goalId` and `event.goalId` when they differ.

### F9 — Five-minute TTL can expire during normal long agent turns

Evidence:

- `src/goal-protocol-tokens.ts:10` — `export const GOAL_PROTOCOL_TOKEN_TTL_MS = 5 * 60_000;`
- `src/runtime-mode-handlers.ts:105` — `content: renderGoalContext(current, observationToken),`
- `src/goal-protocol-guards.ts:125` — `record.expiresAt > now`

Risk: a token injected at agent start can expire before the first mutation in long-running tasks, forcing the model to recover with `get_goal` despite having followed the protocol.

Hardening direction: tune TTL around turn duration, mint tokens lazily via `get_goal`, or expose denial messages that explicitly recover by re-observing.

### F11 — Tests cover revision drift but not reset/expiry and stale-after-pause flows

Evidence from the review:

- `tests/goal-protocol-policy.test.ts` covers revision drift and invalidation.
- Current paused-tool test exercises missing-token denial, not an observed-active token becoming stale after pause.
- No test currently forces token expiry or reset epoch denial.

Hardening direction: add tests for TTL expiry, reset epoch, active-token-then-pause, replace invalidation, no-op progress rejection, blank evidence rejection, and stale evaluator revision race.

## Precedents

- `9f3f465` — `refactor: route goal mutations through operation contracts`; follow-up `5713cad` showed mutation contracts did not cover continuation delivery/retry state.
- `4ee9aec` — `refactor: centralize goal state transitions`; follow-ups added operation contracts and continuation hardening.
- `5713cad` — `fix: harden automatic goal continuation`; no follow-up fixes yet, but establishes the fail-closed pattern for continuation/persistence.

Composite lesson: this codebase repeatedly hardens one boundary, then discovers the adjacent async/lifecycle boundary. The next hardening slice should focus less on adding another prompt/tool rule and more on making authorization, persistence, replay, and lifecycle resets share one scoped revision contract.

## Recommended hardening order

1. Add revision compare-and-swap around async evaluator persistence (`F10`).
2. Scope token registry by session/branch/runtime context and reset on session tree (`F1`, `F2`).
3. Redact token records/details and avoid plain-text token rendering where possible (`F3`, `F4`).
4. Tighten semantic guards: non-empty completion evidence and no-op progress rejection (`F5`, `F6`).
5. Harden replay parsing/migration (`F7`).
6. Add regression tests for expiry/reset/stale-after-pause/replace/no-op/evaluator-race (`F8`, `F9`, `F11`).
