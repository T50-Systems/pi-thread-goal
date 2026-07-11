# Performance Baseline

`pi-thread-goal` treats local state reconstruction and hook/command handling as extension overhead. Model latency, provider requests, and Pi host queue time are excluded.

## Reproduce the baseline

```bash
npm install
npm run benchmark
```

The benchmark runs `createGoalStateSnapshot` against two deterministic branch histories:

- 26 entries: representative of a short interactive goal.
- 1,001 entries: a stress fixture for a long-running goal history.

## Initial local result

Measured 2026-07-11 on Windows with Node 24.18.0 and Vitest 4.1.9:

| Fixture | Mean | p99 | Samples |
|---|---:|---:|---:|
| 26 entries | 0.0605 ms | 0.1172 ms | 8,265 |
| 1,001 entries | 2.2852 ms | 3.2260 ms | 219 |

Both fixtures are comfortably below the initial 50 ms target in [`PRODUCT.md`](PRODUCT.md). This is a local reference baseline, not a production SLO. Record the environment, sample count, mean, and percentile before publishing future performance claims.

## Optimization opportunities

If the 1,001-entry fixture approaches the budget:

1. preserve checkpoint entries during compaction so replay starts from a recent state;
2. avoid repeated state reconstruction inside a single hook/tool execution;
3. measure cloning and parsing separately before changing the event schema;
4. do not cache branch state across branch/tree changes without an explicit invalidation contract.

The benchmark is informational today. It should become a CI gate only after a stable baseline has been recorded on the selected CI runner.
