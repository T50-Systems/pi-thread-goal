# Performance Baseline

`pi-thread-goal` treats local state reconstruction and hook/command handling as extension overhead. Model latency, provider requests, and Pi host queue time are excluded.

## Enforced CI regression floor

```bash
npm ci
npm run verify:performance
```

The deterministic verifier reconstructs the same 1,001-entry branch fixture after 25 warmups, measures 100 independent replays, validates the resulting revision, and exits nonzero when p99 exceeds **50 ms**. This deliberately broad regression budget enforces the PERF-1 ceiling without presenting runner timing as a production SLO. It measures only synchronous `createGoalStateSnapshot` work.

CI runs the verifier three times on `ubuntu-latest` with Node 22. Each invocation emits JSON containing fixture size, warmups, sample count, mean, p99, budget, Node version, operating system, and architecture. The three records are copied to the GitHub Actions step summary, making the hosted-runner baseline visible on every pull request.

The 50 ms floor was selected from the documented 3–4 ms local p99 observations with more than 10x headroom for shared hosted-runner variance. It is the enforced compatibility ceiling; the smaller numbers below are local reference measurements only.

## Local reference benchmark

```bash
npm install
npm run benchmark
```

The benchmark runs `createGoalStateSnapshot` against two deterministic branch histories:

- 26 entries: representative of a short interactive goal.
- 1,001 entries: a stress fixture for a long-running goal history.

Measured 2026-07-11 on Windows with Node 24.18.0 and Vitest 4.1.9:

| Fixture | Mean | p99 | Samples |
|---|---:|---:|---:|
| 26 entries | 0.0605 ms | 0.1172 ms | 8,265 |
| 1,001 entries | 2.2852 ms | 3.2260 ms | 219 |

A separate maturity-assessment run observed a 4.0651 ms local p99 for the 1,001-entry fixture. These local numbers aid investigation but do not replace the enforced CI result. Record the environment, sample count, mean, and percentile before publishing future performance claims.

## Recalibrating the budget

Recalibration is a maintainer-reviewed change:

1. collect at least three successful `performance-regression` job summaries on the current `ubuntu-latest` image;
2. record the runner image, Node version, architecture, sample counts, mean, and p99;
3. investigate outliers and confirm no model, network, or Pi host queue latency entered the measurement;
4. choose a broad threshold above ordinary hosted variance and below an unacceptable user-facing regression;
5. update the verifier constant, this document, tests, and the pull-request evidence together.

Tighten the floor only after stable measurements. If runner-image changes create noise, collect new evidence before changing the threshold; do not silently relax the gate.

## Optimization opportunities

If the 1,001-entry fixture approaches the budget:

1. preserve checkpoint entries during compaction so replay starts from a recent state;
2. avoid repeated state reconstruction inside a single hook/tool execution;
3. measure cloning and parsing separately before changing the event schema;
4. do not cache branch state across branch/tree changes without an explicit invalidation contract.
