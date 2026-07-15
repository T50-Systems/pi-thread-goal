# pi-thread-goal

Pi-native Claude-style `/goal` extension with branch-aware persistence, guarded model tools, status UI, and automatic cross-turn continuation.

`pi-thread-goal` gives Pi a persistent goal system that behaves closer to Claude Code goal semantics: an active objective is carried across turns, progress is updated through guarded tools, completion is validated before mutation, and unmet goals can automatically continue until the objective is satisfied or safely paused.

## Status

- Current version: `0.5.3`
- Language: TypeScript
- Runtime: Pi extension package
- Maturity: usable early release with extensive tests

## Pi compatibility

The supported packed-extension matrix is:

| Set | `@earendil-works/pi-coding-agent` | `@earendil-works/pi-ai` | `typebox` |
|---|---:|---:|---:|
| Maintained minimum | `0.74.2` | `0.74.2` | `1.1.24` |
| Current (latest tested) | `0.80.7` | `0.80.7` | `1.1.38` |

Peer ranges are bounded to these tested versions. Maintainers check the npm registry weekly and before each release; ranges advance only with successful minimum/current tarball evidence. See [`docs/COMPATIBILITY.md`](docs/COMPATIBILITY.md) for the registry basis, provider-free `SessionManager` smoke, update cadence, and release gate.

## Why this exists

Pi has strong extension primitives, but it does not ship a built-in `/goal` workflow that mirrors Claude Code. This package aims for a middle ground:

- simpler than heavyweight draft/review workflow packages;
- more Pi-native than file-backed hacks;
- branch-aware across `/tree`, forks, resume, and compaction;
- automatic when useful, but guarded against runaway loops and stale mutations.

Goal state is persisted as Pi session entries rather than as a separate external database.

## Product vision

Make `pi-thread-goal` the Pi-native standard for safe, observable, low-noise autonomous goal execution across turns.

See [`docs/PRODUCT.md`](docs/PRODUCT.md) for the canonical product promise, principles, success metrics, and roadmap governance.

## What it does

When a goal is active:

1. goal context is injected into future turns;
2. the agent works normally toward the objective;
3. progress/completion tools mutate state only after fresh observations and scoped capabilities;
4. a small evaluator checks at turn end whether the goal is complete;
5. unmet goals can queue the next continuation turn;
6. completed goals are marked complete and the run stops cleanly.

## Features

- Pi-native persistence via `appendEntry(...)`.
- Branch-aware state reconstruction through the active session branch.
- Event-sourced goal history.
- `/goal` command UX for create/status/edit/pause/resume/complete/clear/dismiss.
- Hidden active-goal context injection.
- Automatic continuation after incomplete turns.
- Configurable token budget with `/goal <objective> --tokens 100k`.
- Continuation delivery tracking for queued/sent/started/failed phases.
- Stale continuation watchdog with retry/backoff and visible pause reason.
- Compact status widget and expandable overlay UI.
- Elapsed runtime display in days/hours/minutes/seconds.
- Compaction-aware summary augmentation.
- Guarded model tools with fresh observation/completion capability checks.
- Anti-contradictory completion validation before `complete_goal` succeeds.
- Runaway protection after evaluator-turn or token-budget limits.
- Successful `complete_goal` calls keep the turn alive long enough for a final visible user summary instead of terminating silently.
- Quiet internal tool UX: routine checkpoints avoid user-facing noise.

## Commands

```text
/goal
/goal <objective> [--tokens 100k]
/goal status
/goal doctor
/goal edit
/goal pause
/goal resume [--no-start]
/goal start
/goal clear [--yes]
/goal complete [--yes]
/goal dismiss
/goal <objective> --replace [--start] [--tokens 100k]
```

`/goal edit` opens a structured editor for objective, acceptance criteria, source paths, and token budget. Completed goals remain visible until `/goal dismiss` hides them.

`/goal resume` reactivates a paused goal and starts the next goal turn by default. Use `--no-start` only to update stored status/UI without enqueueing a continuation prompt.

`/goal doctor` prints continuation diagnostics: pending phase, retry attempts, stale status, idle/pending-message probes, and recommended recovery action.

## Model tools

```text
get_goal
create_goal
update_goal_progress
prepare_goal_completion
complete_goal
```

The mutation protocol is intentionally strict:

- observe the current goal before mutating;
- progress updates change the revision;
- completion must be prepared with matching evidence before `complete_goal`;
- paused/completed goals reject stale mutating tools;
- unresolved blockers prevent contradictory completion.
- successful `complete_goal` returns `details.requiresFinalResponse=true` and instructs the agent to send a final visible summary before ending the turn.

## Repository layout

```text
extensions/index.ts          Pi extension entrypoint
src/commands.ts              /goal command parsing and handlers
src/continuation.ts          continuation delivery and watchdog logic
src/evaluator.ts             turn-end evaluator integration
src/goal-operations.ts       create/progress/prepare/complete operations
src/goal-protocol.ts         tool protocol/capability policy
src/goal-state*.ts           event-sourced state reconstruction/persistence
src/runtime*.ts              runtime modes and actions
src/tools.ts                 model tool registration
src/ui.ts                    widget and overlay UI
tests/                       unit, contract, runtime, and e2e-style tests
```

## Quickstart

Prerequisites: [Pi](https://github.com/earendil-works/pi-mono/tree/main/packages/coding-agent) installed and authenticated with a tool-capable model.

### 1. Install the package

```bash
pi install git:github.com/T50-Systems/pi-thread-goal
```

### 2. Start Pi

Open Pi in the directory where you want the goal to run:

```bash
pi
```

### 3. Create a goal

At the Pi prompt, enter:

```text
/goal Create a file named hello-goal.txt containing exactly "Goal complete", then verify its contents.
```

`/goal <objective>` creates the goal and starts work immediately. The goal widget shows the active objective, elapsed time, evaluator turns, token usage, and current progress while the agent works across turns.

### 4. Inspect the result

When the completion condition is satisfied, the goal changes to `complete` and the agent sends a final visible summary. Confirm the state at any time with:

```text
/goal status
```

Completed goals remain visible until you dismiss them:

```text
/goal dismiss
```

### Try it from a checkout

To load the extension from this repository without installing it globally:

```bash
pi --no-extensions -e ./extensions/index.ts
```

## Troubleshooting

### `/goal` is not available

1. Confirm that the package is installed:

   ```bash
   pi list
   ```

2. Run `pi config` and verify that the package extension is enabled.
3. Restart Pi, or run `/reload` if Pi was already open when the package was installed or updated.

### The goal keeps continuing

Run:

```text
/goal status
/goal doctor
```

`/goal doctor` reports the continuation phase, retry count, stale-delivery state, idle and pending-message probes, and a recommended recovery action. If the goal should not continue, pause it explicitly:

```text
/goal pause
```

Automatic continuation is bounded: the extension pauses after the evaluator-turn limit or when the configured token budget is exhausted. A long-running valid goal is not necessarily a runaway loop; use `/goal doctor` to distinguish active work from stale or duplicate delivery.

### The goal stopped before completion

Check `/goal doctor` first. If the goal is paused and the blocking condition has been resolved, resume it with:

```text
/goal resume
```

`/goal resume` reactivates the goal and starts the next goal-directed turn by default. If the goal is already active but needs another turn, use:

```text
/goal start
```

### Goal context appears missing or stale

Goal context is injected as a hidden message, so it is not expected to appear in the visible conversation. Use `/goal status` as the source of truth for the current branch.

Goal state is branch-aware. After `/tree`, a fork, or a resumed session, the selected branch may contain a different goal state. If the expected goal is present but paused, use `/goal resume`; if it is active but idle, run `/goal doctor` and follow its recommended recovery action.

After installing or updating the extension, restart Pi or run `/reload` before diagnosing context injection.

## Development

```bash
npm ci
npm run validate:workflows
npm run lint
npm run typecheck
npm test
npm run test:coverage
npm run benchmark
npm run test:packed   # npm-pack + fresh minimum/current Pi consumers
npm run test:e2e-pi   # opt-in live Pi smoke test
```

## Documentation

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — current components, ownership boundaries, control flow, and extension points.
- [`docs/EXAMPLES.md`](docs/EXAMPLES.md) — practical goal recipes and integration guidance.
- [`docs/LOOP_DESIGN.md`](docs/LOOP_DESIGN.md) — proposed boundary for a separate time-driven `/loop` companion.
- [`docs/PERFORMANCE.md`](docs/PERFORMANCE.md) — reproducible local performance baseline and optimization guidance.
- [`docs/PLAN.md`](docs/PLAN.md) — original architecture and design intent.
- [`docs/ROADMAP.md`](docs/ROADMAP.md) — planned issues.
- [`docs/PRODUCT.md`](docs/PRODUCT.md) — canonical product vision, principles, success metrics, and roadmap governance.
- [`docs/WORKLOG.md`](docs/WORKLOG.md) — implementation log.
- [`docs/WORKFLOW_SECURITY.md`](docs/WORKFLOW_SECURITY.md) — immutable GitHub Actions pins, offline semantic validation, and update-review policy.
- [`docs/COMPATIBILITY.md`](docs/COMPATIBILITY.md) — exact supported Pi/TypeBox sets, packed-consumer evidence, and release update policy.
- [`CHANGELOG.md`](CHANGELOG.md) — release history.

## Current non-goals

- Time-based `/loop` scheduling.
- Multi-goal queues.
- Detached background runners.
- Full interactive end-to-end fixtures for every UI path.

## License

MIT
