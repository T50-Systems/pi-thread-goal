# Product Vision and Success Metrics

## Vision

Make `pi-thread-goal` the Pi-native standard for safe, observable, low-noise autonomous goal execution across turns.

## Product promise

A user can state a completion condition once and trust the extension to continue useful work, stop safely, preserve branch-local state, and surface only information that requires attention.

## Principles

1. Pi-native lifecycle and persistence.
2. Safe autonomy over maximum autonomy.
3. Observable state and explicit recovery.
4. Quiet by default; actionable when visible.
5. Direct UX with minimal workflow ceremony.

## Success metrics

| ID | Dimension | Definition | Target | Evidence |
|---|---|---|---|---|
| REL-1 | Runaway safety | Runs that exceed the configured continuation limit, enqueue after terminal/pause state, or create duplicate continuation turns | 0 known occurrences; 100% guard regression pass | continuation/runtime/policy tests + pre-release live smoke |
| REL-2 | State correctness | Core create→progress→complete and pause/resume/tree/compaction scenarios preserve valid branch-local state | 100% core matrix pass on supported Node/Pi versions | unit, real-runtime and live E2E suites |
| PERF-1 | Local overhead | p95 synchronous extension overhead for state reconstruction + hook/command handling, excluding model/network/host queue time | <50 ms on the documented reference fixture | reproducible local/CI benchmark; baseline must be recorded before enforcement |
| UX-1 | Routine noise | Raw protocol/capability diagnostics or unsolicited internal notifications during a successful normal run | 0 raw diagnostics; at most 1 unsolicited lifecycle notification | tool/UI/runtime output assertions |
| UX-2 | Recovery clarity | User-visible failures that include a concrete recovery action | 100% for classified continuation/protocol failures | error-contract tests and `/goal doctor` snapshots |

## Measurement rules

- Never count model latency as extension overhead.
- A runaway is a safety violation, not merely a long valid goal.
- Publish baseline, environment, sample size and percentile with performance claims.
- Do not add user telemetry without an explicit privacy decision/ADR.
- Review targets at each minor release; tighten only after a stable baseline.

## Roadmap governance

Every `Next` item must list: KPI, expected movement, verification evidence.
Completed items must link release/test evidence. Items without a measurable outcome remain in `Soon`/`Later`.
