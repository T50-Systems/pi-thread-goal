# Worklog

## 2026-07-01

### Goal status custom UI
- added a custom `/goal` / `/goal status` overlay using `ctx.ui.custom()`
- made the overlay expand/collapse on `Enter` or `Space` and close on `Esc`
- kept the persistent goal widget intentionally compact so the dense detail only appears on demand
- added renderer tests for collapsed and expanded overlay states
- verified with:
  - `npm run typecheck`
  - `npm test`

## 2026-06-30

### Created `pi-thread-goal`
- Established a local Pi package for `/goal`
- Chose Pi-native session-entry persistence instead of file-backed state
- Chose direct command UX instead of a mandatory draft-review workflow

### Architecture implemented
- event-sourced goal state reducer
- active-goal hidden context injection
- footer + widget UI
- compaction summary augmentation for active goals
- post-turn evaluator model that decides whether the goal condition is met
- automatic next-turn continuation when the evaluator says the goal is not yet met

### Course correction after reviewing Claude Code docs
- Verified from Claude Code docs that `/goal` includes cross-turn autocontinuation
- Verified that `/loop` is interval-based scheduling and should remain a separate future package/feature
- Updated `pi-thread-goal` to match `/goal` semantics more closely:
  - `/goal <objective>` now starts work immediately
  - active goals are evaluated after each turn
  - unmet goals trigger another turn automatically

### Verification completed
- `npm install`
- `npm run typecheck`
- `npm test`
- RPC command discovery confirmed that Pi now loads extension command `goal`
- package installed globally into Pi via local path

### Follow-up polish
- updated goal UI so the goal widget is hidden when `status === "complete"`
- added UI regression coverage for complete-goal widget hiding
- published and pinned the package globally from GitHub release tag:
  - `git:github.com/T50-Systems/pi-thread-goal@v0.1.0`
- removed the previous local-path global install so Pi now uses the GitHub-pinned package by default
