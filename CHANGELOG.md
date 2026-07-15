# Changelog

## [Unreleased]

### Added

- configurable evaluator model selection through `GOAL_EVALUATOR_MODEL` or an evaluation option, with fallback to the normal provider heuristic when the requested model is unavailable.
- explicit evaluator timeout configuration documentation for `GOAL_EVALUATOR_TIMEOUT_MS`.
- repository-wide coverage floors with focused command-mutation and runtime-decision regression tests.
- a deterministic 1,001-entry replay regression check with a 50 ms p99 CI budget and hosted-runner summaries.
- a security policy, trust-boundary documentation, and weekly Dependabot checks for npm and GitHub Actions.
- immutable commit-SHA pins for third-party GitHub Actions plus offline semantic and pin-policy validation with negative fixtures.

### Changed

- CI now declares read-only repository permissions, publishes LCOV output, and enforces the replay performance budget.
- roadmap governance now separates issue-backed committed work, uncommitted ideas, and completed release/test evidence.

## 0.5.3 - 2026-07-09

### Added

- real-runtime test harness (`tests/pi-runtime.e2e.test.ts`) that drives the
  extension against Pi's actual `SessionManager` instead of a hand-built fake
  context. It binds the extension, creates a goal, and runs the
  get_goal -> prepare_goal_completion -> complete_goal handshake while the real
  session leaf advances between calls. Reverting either the v0.5.1 or v0.5.2
  fix makes this harness fail with the original user-facing error, so both
  shipped bugs would have been caught before release.
- opt-in live end-to-end smoke (`tests/pi-live.e2e.test.ts`, run via
  `npm run test:e2e-pi`) that launches a real Pi session with a real model,
  has it create and complete a goal through the tools, and asserts no protocol
  errors and that the goal reached `complete`. Skipped by default so the normal
  suite stays fast and offline; intended as a pre-release check.

### Changed

- hardened active-goal prompts and progress-tool guidance so checkpoint/status-only
  responses after a completed subtask are treated as invalid for ongoing batch
  goals, and `Blocked` is reserved for real operational blockers rather than
  technical risks or actionable uncertainty.
- added runtime checkpoint-only stop detection, blocker classification warnings,
  and continuation retry fallback diagnostics so unmet goals continue with clearer
  reasons and stale delivery retries alternate transport modes before pausing.
- clarified caller flow for goal mutations: agents must use `get_goal ->
  update_goal_progress`, and after any progress mutation call `get_goal` again
  before completion or another mutation because the goal revision changed.
- successful `complete_goal` calls now keep the turn alive and require a final
  visible user summary instead of ending immediately with only internal tool output.

## 0.5.2 - 2026-07-07

### Fixed

- goal mutation tools (`prepare_goal_completion`, `update_goal_progress`,
  `complete_goal`) no longer reject with "Call get_goal before mutating goal
  state." immediately after `get_goal`. v0.5.1 keyed the protocol capability
  cache by the session leaf, which advances on every appended entry, so the
  key moved between `get_goal` and the mutating tool within a single turn.
  The capability is now scoped by session id; cross-branch isolation still
  holds via the epoch reset on `session_start`/`session_tree` and the
  goalId + revision checks. Adds a regression test that advances the leaf
  between `get_goal` and the mutation.

## 0.5.1 - 2026-07-07

### Fixed

- the extension no longer throws "Goal protocol requires explicit sessionId
  and branchId context." when binding to a real Pi session. It required an
  authoritative `ctx.goalProtocol` that no shipped Pi host provides (broken
  since v0.4.0); it now derives the protocol context from
  `ctx.sessionManager.{sessionId, leafId}`, honoring an explicit
  `goalProtocol` when a host supplies one. Tests now exercise the real
  session-manager context shape instead of a fake `goalProtocol`, and the
  fix was verified against a live Pi 0.80.3 session.

## 0.5.0 - 2026-07-07

### Added

- Biome linting and formatting scripts for the existing TypeScript style.
- Coverage reporting via `npm run test:coverage` with V8, text, and lcov output.
- In-process E2E smoke coverage for `/goal` auto-continuation through the public extension entry.
- Tag-based release workflow with npm provenance publishing.
- Contributor guide and GitHub issue forms for bug reports and feature requests.

### Changed

- consolidated the source tree from 41 modules into 19: evaluator, command
  surface, goal state, persistence, protocol, operations, continuation ports,
  runtime guards, pure policies, and UI formatting each now live in a single
  module. No behavior changes; boundary tests were retargeted at the
  consolidated modules and the commands/handlers import cycle was removed.
- removed six unused goal-operation contract wrappers, collapsed the
  `reduceGoalStateMachine`/`reduceGoalState` dual export into one name, and
  deduplicated the `isRecord` type guard into a single `types.ts` export.
- split CI into a single lint-and-typecheck job plus a Node 22/24 test matrix
  so version-independent checks no longer run twice per push.
- the boundary test now derives its pure-module set from `src/` minus an
  explicit adapter/runtime allowlist instead of a hardcoded file list, and the
  release workflow surfaces a visible job-summary warning when `NPM_TOKEN` is
  absent instead of skipping publish silently.

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
