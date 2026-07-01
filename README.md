# pi-thread-goal

Pi-native Claude-style `/goal` for Pi.

`pi-thread-goal` adds a persistent goal system that behaves much closer to Claude Code semantics:
- branch-aware goal state
- hidden goal context on every active turn
- post-turn evaluation of whether the goal is complete
- automatic cross-turn continuation until the goal is met
- model tools for reading and updating progress safely

## Status

- current version: `0.2.0`
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
- compact widget + interactive overlay status UI
- compaction-aware summary augmentation
- model tools with explicit guardrails

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
/goal <objective>
/goal status
/goal edit
/goal pause
/goal resume [--start]
/goal start
/goal clear [--yes]
/goal complete [--yes]
/goal <objective> --replace [--start]
```

## Model tools

- `get_goal`
- `create_goal`
- `complete_goal`
- `update_goal_progress`

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
npm run typecheck
npm test
```

## Release scope for `v0.2.0`

This release establishes:
- core `/goal` command surface
- Pi-native persistent state
- evaluator-driven continuation loop
- compact persistent widget plus expandable `/goal status` overlay
- tests for commands, state, and runtime behavior

It does **not** yet include:
- time-based `/loop`
- multi-goal queues
- detached background runners
- richer evaluator configuration UX
- full interactive end-to-end fixtures

## Docs

- `docs/PLAN.md` — architecture and design intent
- `docs/WORKLOG.md` — implementation log
- `docs/ROADMAP.md` — planned issues after `v0.1.0`
- `CHANGELOG.md` — release history

## License

MIT
