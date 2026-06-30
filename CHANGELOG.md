# Changelog

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
