# Changelog

## 0.3.0 - 2026-07-01

### Added
- persistent goal widget expansion controls via `/goal toggle`, `/goal expand`, and `/goal collapse`.

### Improved
- expanded widget mode can now show richer progress, blocked items, criteria, and paths without relying only on the overlay.
- added regression coverage for widget expansion command parsing and expanded widget rendering.

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
