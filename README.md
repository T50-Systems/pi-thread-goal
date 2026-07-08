# pi-thread-goal

Pi-native Claude-style `/goal` for Pi.

`pi-thread-goal` adds a persistent goal system that behaves much closer to Claude Code semantics:

- branch-aware goal state
- hidden goal context on every active turn
- post-turn evaluation of whether the goal is complete
- automatic cross-turn continuation until the goal is met
- model tools for reading and updating progress safely

## Status

- current version: `0.5.2`
- language: TypeScript
- runtime: Pi extension package
- maturity: usable early release

## Why this exists

Pi already has strong extension primitives, but it does not ship a built-in `/goal` workflow matching Claude Code's behavior.

This package aims for the middle ground:

- simpler than heavyweight draft/review workflow packages
- more Pi-native than file-backed hacks
- closer to official Claude `/goal` semantics than manual-only goal helpers

Instead of storing state in external files, it persists goal events through Pi session entries. That means goal state follows:

- `/tree`
- forks
- resume
- compaction

## What it does

When a goal is active:

1. goal context is injected into future turns
2. the agent works normally toward the objective
3. at the end of the turn, a small evaluator model checks whether the goal condition is satisfied
4. if the goal is not yet complete, the extension starts the next turn automatically
5. when the goal is complete, it is marked complete and the run stops

## Features

- Pi-native persistence via `appendEntry(...)`
- branch-aware state reconstruction via `getBranch()`
- event-sourced goal history
- direct command UX
- automatic continuation after each turn
- compact widget with subtle background styling + interactive overlay status UI
- elapsed goal runtime is shown in days, hours, minutes, and seconds in the widget, overlay, and status summary
- compaction-aware summary augmentation
- model tools with explicit guardrails
- runaway protection: automatic continuation pauses after 25 evaluator turns without completion or when a configured token budget is reached
- configurable token budget via `/goal <objective> --tokens 100k`
- continuation delivery tracking records queued/sent/started/failed phases,
  retry attempts, and stale pending state
- stale continuation watchdog retries delivery with backoff and pauses with a
  visible reason after repeated delivery failures
- stale tool-call protection: progress/completion tools refuse to mutate paused or completed goals
- retryable vs non-retryable evaluator error handling, with non-retryable failures pausing the goal for review
- anti-contradictory completion validation before `complete_goal` can mark a goal complete
- Mealy-style protocol policy uses scoped internal auto-capabilities before model tools can mutate or complete a goal
- `complete_goal` returns `terminate: true` after successful completion so the turn can stop cleanly
- quiet internal tool UX: progress/checkpoint tools return concise acknowledgements and automatic continuation avoids routine chatter
- goal state is shown in the widget/overlay, not in Pi's input-adjacent status line

## Install

```bash
pi install /absolute/path/to/pi-thread-goal
```

Or test without installing:

```bash
pi --no-extensions -e ./extensions/index.ts
```

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

`/goal edit` opens a structured editor for the objective, acceptance criteria, source paths, and token budget. Completed goals remain visible in the widget until `/goal dismiss` hides them.

`/goal resume` reactivates a paused goal and starts the next goal turn by default. Use `/goal resume --no-start` only when you want to update the stored status/UI without enqueueing a continuation prompt.

`/goal doctor` prints continuation diagnostics: pending phase, retry attempts,
stale status, idle/pending-message probes, and a recommended recovery action.

## Model tools

- `get_goal`
- `create_goal`
- `prepare_goal_completion`
- `complete_goal`
- `update_goal_progress`

Tool results are intentionally terse. The widget, `/goal status`, and structured
tool `details` preserve debuggability without turning every internal checkpoint
into user-facing narration. Mutating model tools require scoped internal
auto-capabilities, not bearer tokens copied by the model: `get_goal` registers
a fresh observation for the current context, `prepare_goal_completion` registers
a completion candidate for the supplied evidence, and `complete_goal` must use
matching evidence. Completion is guarded against contradictory state such as
unresolved blockers, and a successful `complete_goal` response includes
`terminate: true`. The extension clears Pi's input-adjacent goal status line so
the active objective does not appear below the text box.

## Design principles

- active goals affect the agent via hidden context every turn
- setting a goal starts work immediately
- each completed turn is evaluated by a small model
- unmet goals automatically continue into the next turn
- replacement is guarded by UI confirmation or `--replace`
- `/goal` is distinct from future interval-based `/loop` behavior

## Development

Install dependencies:

```bash
npm install
```

Run checks:

```bash
npm run lint
npm run typecheck
npm test
npm run test:coverage
```

## Release scope for `v0.3.0`

This release includes:

- core `/goal` command surface
- Pi-native persistent state
- evaluator-driven continuation loop
- compact persistent widget plus expandable `/goal status` overlay
- tests for commands, state, and runtime behavior
- automatic continuation safety cap to prevent unbounded evaluator loops

It does **not** yet include:

- time-based `/loop`
- multi-goal queues
- detached background runners
- richer evaluator configuration UX
- full interactive end-to-end fixtures

## Docs

- `docs/PLAN.md` — architecture and design intent
- `docs/WORKLOG.md` — implementation log
- `docs/ROADMAP.md` — planned issues after `v0.3.0`
- `CHANGELOG.md` — release history

## License

MIT
