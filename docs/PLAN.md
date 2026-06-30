# Plan

## Goal

Build a better `/goal` package for Pi that combines:
- the directness of lightweight goal packages
- the Pi-native state model of branch-aware packages
- the core semantics documented by Claude Code `/goal`

## Learnings from existing packages

### From `pi-goal`
Good:
- very direct UX
- small command surface
- goal-focused prompts
- easy mental model

Weaknesses:
- file-backed persistence instead of Pi session entries
- less naturally aligned with `/tree`, compaction, and branch state
- namespace/runtime compatibility concerns with older Pi package imports
- docs and code appeared somewhat out of sync

### From `pi-agent-goal`
Good:
- uses Pi-native session entries via `appendEntry`
- reconstructs state from `getBranch()`
- branch-aware and compaction-aware
- stronger docs, tests, and package shape

Weaknesses:
- more complex than needed for a direct Codex/Claude-like `/goal`
- draft/review/start flow is heavier than desired for fast command use
- includes more workflow surface than strictly necessary for a first strong version

## Learning from Claude Code docs

Official Claude Code docs clarify the split:
- `/goal` = completion-condition loop that continues **after each turn finishes** until a separate evaluator says the condition is met
- `/loop` = interval-based scheduling that continues **after time elapses**

That means `/goal` must include:
- immediate start when set
- post-turn evaluation
- automatic continuation when not yet complete

And `/loop` should stay a separate future feature/package.

## Product decision

This package will be:
- **Pi-native in storage and lifecycle**
- **direct in command UX**
- **faithful to Claude Code `/goal` semantics**
- **autonomous across turns, but not time-scheduled**

That means:
- `/goal <objective>` creates or replaces a goal directly
- setting a goal starts work immediately
- active goals are injected as hidden context for future turns
- after each turn, an evaluator model decides whether the goal condition is met
- if not met, the extension starts the next turn automatically
- `/loop` remains a separate future concern for interval scheduling

## Architecture

### 1. State model
State is persisted as Pi custom session entries:
- custom type: `thread-goal-state`
- stored with `pi.appendEntry(...)`
- reconstructed from `ctx.sessionManager.getBranch()`

Benefits:
- follows `/tree`
- follows forks and resume
- does not require an external JSON store
- survives reload and compaction naturally

### 2. Event-sourced reducer
The package stores goal mutations as events:
- `create`
- `replace`
- `edit`
- `pause`
- `resume`
- `clear`
- `complete`
- `progress`
- `evaluation`

Reducer rebuilds the current goal state from the active branch.

### 3. Runtime behavior
- `before_agent_start`
  - injects hidden goal context for active goals
- `context`
  - filters stale goal context messages and keeps only the current goal context
- `agent_end`
  - runs a small evaluator model against the goal condition
  - persists evaluator reason and token usage
  - auto-completes the goal when the evaluator says the condition is met
  - otherwise starts the next continuation turn immediately
- `session_start` / `session_tree`
  - refresh goal UI from branch state
  - resume active goals when resuming a session
- `session_before_compact`
  - adds goal summary into the compaction summary when relevant

### 4. User-facing command behavior
Main UX rules:
- `/goal` shows current goal/help
- `/goal <objective>` creates a goal directly and starts work immediately
- existing goal replacement requires confirmation or `--replace`
- `/goal start` manually kicks off another goal-directed turn when needed
- `/goal resume --start` resumes and immediately starts
- destructive commands require confirmation or `--yes`

### 5. Model-facing tools
- `get_goal`
  - read goal state
- `create_goal`
  - only when explicitly requested
- `complete_goal`
  - explicit completion with optional evidence
- `update_goal_progress`
  - progress only, no objective rewrite

### 6. UI model
- footer status via `setStatus("goal", ...)`
- widget above the editor via `setWidget("goal", ...)`
- small, readable, non-invasive display
- evaluator reason and run stats visible from `/goal`

## Non-goals for v1

Not in the first version:
- time-based scheduling (`/loop`)
- PRD/doc import workflow
- complex draft-review wizard
- multi-goal queues
- cloud or desktop detached task runners

## Verification plan

1. typecheck
2. unit tests for parser/reducer/runtime filtering
3. RPC command discovery to confirm Pi loads `/goal`
4. optional manual interactive validation in Pi
