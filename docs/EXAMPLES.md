# Examples and Recipes

## Bounded implementation task

```text
/goal Add input validation to src/config.ts, cover invalid and valid inputs with tests, and run the focused test suite.
```

A good goal names the desired outcome, relevant path, and verification condition without prescribing every implementation step.

## Batch issue work

```text
/goal Process the open issues labeled bug one at a time. For each issue: reproduce it, implement a focused fix, run validation, commit, and close only after evidence is available.
```

For batch goals, record the completed issue and immediately select the next unfinished item. Do not treat a status summary as completion of the batch.

## Repository documentation refresh

```text
/goal Audit README.md against the current CLI, correct stale commands, add a copy-paste quickstart, verify links, and summarize the changes.
```

## Token-bounded work

```text
/goal Investigate and fix the flaky continuation test --tokens 100k
```

The extension pauses when the configured budget is exhausted rather than continuing indefinitely.

## Recovery recipe

If a goal appears idle or continues unexpectedly:

```text
/goal status
/goal doctor
```

Follow the recommended action. Common choices are:

```text
/goal pause
/goal resume
/goal start
```

## Integration pattern for extension authors

`pi-thread-goal` stores state as custom Pi session entries and reconstructs it from the active branch. Integrations should interact through the public slash commands or guarded model tools rather than editing session entries manually. See [`ARCHITECTURE.md`](ARCHITECTURE.md) for boundaries and [`PRODUCT.md`](PRODUCT.md) for success metrics.
