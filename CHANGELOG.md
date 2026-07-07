# Changelog

## [Unreleased]

### Changed

- consolidated the source tree from 41 modules into 19: evaluator, command
  surface, goal state, persistence, protocol, operations, continuation ports,
  runtime guards, pure policies, and UI formatting each now live in a single
  module. No behavior changes; boundary tests were retargeted at the
  consolidated modules and the commands/handlers import cycle was removed.

## 0.4.0 - 2026-07-07

### Added

- `/goal doctor` reports continuation phase, retry attempts, stale state, and
  recovery guidance.
- `prepare_goal_completion` validates evidence and registers the completion
  candidate required by `complete_goal`.

### Fixed

- active goals now retry stale continuation delivery with backoff and pause with a
  visible reason after repeated delivery failures instead of remaining silently active.
- model goal mutations now require scoped internal auto-capabilities, preventing
  completion calls based only on stale summaries or unobserved state.
- stale async evaluator results are skipped when goal revision changes during
  evaluation, avoiding appends from pre-await snapshots.

## 0.3.0 - 2026-07-01

### Added

- persistent goal widget expansion controls via `/goal toggle`, `/goal expand`, and `/goal collapse`.

### Improved

- expanded widget mode can now show richer progress, blocked items, criteria, and paths without relying only on the overlay.
- added regression coverage for widget expansion command parsing and expanded widget rendering.
- automatic continuation now pauses after 25 unmet evaluator turns to prevent runaway loops.
- hardened resume/reentry continuation guards to avoid duplicate queued goal turns.
- reduced internal goal-tool chatter with terse tool acknowledgements and quieter automatic continuation notifications.
- stopped rendering active goal text in Pi's input-adjacent status line; goal visibility now lives in the widget and status overlay.
- added subtle background styling to the persistent goal widget.
- added elapsed runtime display to the persistent widget, overlay, and status summary.
- expanded `/goal edit` to edit objective, acceptance criteria, and source paths in one structured document.
- completed goal widgets now stay visible until dismissed with `/goal dismiss`.
- added token budget support with `/goal --tokens 100k`, budget-aware widget/status output, and automatic pause at budget exhaustion.
- blocked stale progress/completion tool calls after a goal is paused or completed.
- added retryable/non-retryable evaluator error classification so non-retryable failures pause the goal instead of looping.
- added anti-contradictory completion validation for `complete_goal` and evaluator-driven completion.
- successful `complete_goal` tool calls now return `terminate: true` so the turn can stop cleanly.

## 0.2.0 - 2026-07-01

### Added

- interactive `/goal` status overlay via `ctx.ui.custom()` with expand/collapse controls for richer on-demand detail.

### Improved

- kept the persistent goal widget compact while moving detail density into the overlay panel.
- added regression coverage for the compact widget and overlay rendering.

## 0.1.0 - 2026-06-30

Initial release.

### Added

- `/goal` command set for creating, inspecting, pausing, resuming, starting, clearing, and completing goals
- Pi-native persistence using custom session entries
- branch-aware goal reconstruction from session history
- hidden active-goal context injection
- post-turn evaluator model for completion checks
- automatic cross-turn continuation when the goal is not yet met
- goal UI status/widget rendering
- compaction summary augmentation for active goals
- model tools: `get_goal`, `create_goal`, `complete_goal`, `update_goal_progress`
- tests for commands, reducer/state, and runtime filtering
- CI workflow for typecheck and tests
