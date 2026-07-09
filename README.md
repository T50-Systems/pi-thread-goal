# pi-thread-goal

Pi-native Claude-style `/goal` extension with branch-aware persistence, guarded model tools, status UI, and automatic cross-turn continuation.

`pi-thread-goal` gives Pi a persistent goal system that behaves closer to Claude Code goal semantics: an active objective is carried across turns, progress is updated through guarded tools, completion is validated before mutation, and unmet goals can automatically continue until the objective is satisfied or safely paused.

## Status

- Current version: `0.5.3`
- Language: TypeScript
- Runtime: Pi extension package
- Maturity: usable early release with extensive tests

## Why this exists

Pi has strong extension primitives, but it does not ship a built-in `/goal` workflow that mirrors Claude Code. This package aims for a middle ground:

- simpler than heavyweight draft/review workflow packages;
- more Pi-native than file-backed hacks;
- branch-aware across `/tree`, forks, resume, and compaction;
- automatic when useful, but guarded against runaway loops and stale mutations.

Goal state is persisted as Pi session entries rather than as a separate external database.

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

## Install

```bash
pi install git:github.com/T50-Systems/pi-thread-goal
```

Or test without installing globally:

```bash
pi --no-extensions -e ./extensions/index.ts
```

## Development

```bash
npm install
npm run lint
npm run typecheck
npm test
npm run test:coverage
npm run test:e2e-pi   # opt-in live Pi smoke test
```

## Documentation

- [`docs/PLAN.md`](docs/PLAN.md) — architecture and design intent.
- [`docs/ROADMAP.md`](docs/ROADMAP.md) — planned issues.
- [`docs/WORKLOG.md`](docs/WORKLOG.md) — implementation log.
- [`CHANGELOG.md`](CHANGELOG.md) — release history.

## Current non-goals

- Time-based `/loop` scheduling.
- Multi-goal queues.
- Detached background runners.
- Full interactive end-to-end fixtures for every UI path.

## License

MIT
