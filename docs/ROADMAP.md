# Roadmap

This roadmap separates issue-backed committed work from uncommitted ideas. Priority and commitment are maintainer decisions; an issue link records an approved backlog item, not a promise of a delivery date.

## Next — committed

| Work | KPI | Expected movement | Owner / status | Verification evidence |
|---|---|---|---|---|
| [#33 Enforce coverage floors](https://github.com/T50-Systems/pi-thread-goal/issues/33) | REL-1, REL-2 | Prevent regressions in command mutations and runtime decisions | Maintainers / open | enforced global coverage report + focused branch tests |
| [#34 Publish security and dependency contract](https://github.com/T50-Systems/pi-thread-goal/issues/34) | REL-1 | Make disclosure, trust boundaries, least privilege, and dependency upkeep explicit | Maintainers / open | security policy + workflow/config validation |

## Soon — committed

| Work | KPI | Expected movement | Owner / status | Verification evidence |
|---|---|---|---|---|
| [#35 Gate 1,001-entry replay performance](https://github.com/T50-Systems/pi-thread-goal/issues/35) | PERF-1 | Detect material local replay regressions without counting provider or host latency | Maintainers / open | three-sample CI summary + non-benchmark budget check |
| [#36 Govern measurable open backlog](https://github.com/T50-Systems/pi-thread-goal/issues/36) | REL-1 | Keep planned work distinguishable from shipped work and ideas | Maintainers / open | minor-release roadmap review |

## Ideas — not committed

These entries have no delivery commitment. Before promotion to `Next`, maintainers must create or approve an open issue and add KPI, expected movement, owner/status, and verification evidence.

| Idea | Potential KPI | Status |
|---|---|---|
| Optional export/import or inspection helpers for goal history | REL-2, UX-2 | Not committed |
| Stronger compaction and resume edge-case coverage | REL-2 | Not committed |
| Multi-goal queues or goal stacks | TBD | Not committed |
| GUI affordances in `pi-gui` for goals | UX-2 | Not committed |
| Richer policy controls for automatic completion versus manual confirmation | REL-1 | Not committed |

## Completed evidence

| Work | Shipped evidence |
|---|---|
| [#1 Interactive E2E smoke](https://github.com/T50-Systems/pi-thread-goal/issues/1) | [v0.5.3 release](https://github.com/T50-Systems/pi-thread-goal/releases/tag/v0.5.3) and [`pi-live.e2e.test.ts`](https://github.com/T50-Systems/pi-thread-goal/blob/main/tests/pi-live.e2e.test.ts) |
| [#2 Evaluator model/timeout configuration](https://github.com/T50-Systems/pi-thread-goal/issues/2) | [`evaluator-adapter.test.ts`](https://github.com/T50-Systems/pi-thread-goal/blob/main/tests/evaluator-adapter.test.ts) and [`evaluator.test.ts`](https://github.com/T50-Systems/pi-thread-goal/blob/main/tests/evaluator.test.ts) |
| [#3 Reduce internal tool noise](https://github.com/T50-Systems/pi-thread-goal/issues/3) | [v0.3.0 release](https://github.com/T50-Systems/pi-thread-goal/releases/tag/v0.3.0) and [`tools.test.ts`](https://github.com/T50-Systems/pi-thread-goal/blob/main/tests/tools.test.ts) |
| [#4 Resume/reentry guards](https://github.com/T50-Systems/pi-thread-goal/issues/4) | [v0.5.3 release](https://github.com/T50-Systems/pi-thread-goal/releases/tag/v0.5.3) and [`continuation.test.ts`](https://github.com/T50-Systems/pi-thread-goal/blob/main/tests/continuation.test.ts) |
| [#5 Rich status telemetry](https://github.com/T50-Systems/pi-thread-goal/issues/5) | [v0.3.0 release](https://github.com/T50-Systems/pi-thread-goal/releases/tag/v0.3.0), [`ui.test.ts`](https://github.com/T50-Systems/pi-thread-goal/blob/main/tests/ui.test.ts), and [`PERFORMANCE.md`](PERFORMANCE.md) |

## Review cadence

Maintainers review this backlog before every minor release. During that review they verify issue state and evidence links, assign or reconfirm each `Next` owner/status, and compare expected KPI movement with results. A committed item with no progress for two consecutive minor-release reviews is moved to `Soon` or `Ideas`; an obsolete or unmeasurable item is removed, with rationale retained in its issue. Closed work is moved to `Completed evidence` and never remains presented as pending.
