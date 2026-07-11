# Roadmap

This roadmap tracks the highest-value follow-up work after `v0.1.0`.

## Next

| Priority | Work | KPI | Expected movement | Evidence |
|---|---|---|---|---|
| Next | [#1](https://github.com/T50-Systems/pi-thread-goal/issues/1) Interactive E2E smoke | REL-1, REL-2 | Make release safety/correctness executable | live E2E pass |
| Next | [#2](https://github.com/T50-Systems/pi-thread-goal/issues/2) Evaluator model/timeout config | REL-2 | Reduce non-retryable evaluator stalls | policy + runtime tests |
| Next | [#3](https://github.com/T50-Systems/pi-thread-goal/issues/3) Reduce internal tool noise | UX-1 | Reach zero raw diagnostics in normal runs | output assertions |
| Next | [#4](https://github.com/T50-Systems/pi-thread-goal/issues/4) Resume/reentry guards | REL-1 | Eliminate duplicate/stale continuations | continuation regression suite |

## Soon

| Priority | Work | KPI | Expected movement | Evidence |
|---|---|---|---|---|
| Soon | [#5](https://github.com/T50-Systems/pi-thread-goal/issues/5) Rich status telemetry | UX-2; enables PERF-1 baselining | Improve diagnosability without default noise | UI snapshots + benchmark report |
| Soon | issue templates and contribution docs | TBD | | |
| Soon | optional export/import or inspection helpers for goal history | TBD | | |
| Soon | stronger compaction and resume edge-case coverage | REL-2 | | |

## Later

| Priority | Work | KPI | Expected movement | Evidence |
|---|---|---|---|---|
| Later | [#6](https://github.com/T50-Systems/pi-thread-goal/issues/6) Design companion `/loop` package | TBD | | |
| Later | multi-goal queues or goal stacks | TBD | | |
| Later | GUI affordances in `pi-gui` for goals | UX-2 | | |
| Later | richer policy controls for auto-complete vs. manual confirmation | TBD | | |

*Note: Completed items are moved out of this document and into GitHub releases/issues. All new items targeting `Next` must list a KPI.*
