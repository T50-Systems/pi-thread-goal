# pi-thread-goal

Persistent Claude-style `/goal` workflows for Pi with:
- branch-aware session state
- simple direct command UX
- automatic cross-turn continuation
- hidden goal context on every active turn
- progress tools for the model

## Why this exists

This package is intentionally between two extremes:
- simpler than heavy draft/review goal packages
- more Pi-native than file-backed goal hacks

It uses Pi session entries (`appendEntry`) instead of an external store, so goal state follows `/tree`, forks, resume, and compaction correctly.

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

## Design choices

- active goals affect the agent via hidden context every turn
- setting a goal starts work immediately
- each completed turn is evaluated by a small model
- unmet goals automatically continue into the next turn
- replacement is guarded by UI confirmation or `--replace`

## Docs

- `docs/PLAN.md` — learnings, architecture, and implementation plan
- `docs/WORKLOG.md` — implementation log
