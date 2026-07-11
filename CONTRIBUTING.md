# Contributing

## Development setup

### Prerequisites

- **Node.js**: `>=22.0.0` (required for modern ESM and Pi compatibility).
- **Pi CLI**: installed globally via `npm install -g @earendil-works/pi-coding-agent` (if you want to test the extension interactively).
- **GitHub CLI (`gh`)**: optional but recommended for roadmap issue orchestration.

### Shortest path to a verified change

1. **Clone the repository:**
   ```bash
   git clone https://github.com/T50-Systems/pi-thread-goal.git
   cd pi-thread-goal
   ```

2. **Install dependencies:**
   ```bash
   npm install
   ```

3. **Make your change:**
   Edit files in `src/`, `tests/`, or `docs/`. See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for module boundaries.

4. **Run the local checks:**
   ```bash
   npm run lint
   npm run typecheck
   npm test
   ```

5. **Test interactively (optional):**
   To test the extension inside Pi without installing it globally, run:
   ```bash
   pi --no-extensions -e ./extensions/index.ts
   ```
   Then type `/goal Start my test goal` in the Pi prompt.

### Environment variables

- `GOAL_EVALUATOR_TIMEOUT_MS`: overrides the default 45-second evaluator timeout during tests or live execution.
- `GOAL_EVALUATOR_MODEL`: selects an evaluator model as `provider/model-id` (for example `google/gemini-2.5-flash`) or a model ID for the active provider. Missing models fall back to the normal selection policy.
- `PI_E2E`: set to `1` when running `npm run test:e2e-pi` to signal the live smoke suite.

Install dependencies and run the standard checks before opening a PR:

```bash
npm install
npm run lint
npm run typecheck
npm test
```

Use `npm run lint:fix` for safe Biome formatting fixes. Coverage can be checked with:

```bash
npm run test:coverage
```

## Code style

This package is TypeScript ESM for Node >=22. Imports between local TypeScript modules must use `.js` extensions.

Biome owns formatting and linting. Keep the existing style: tabs, double quotes, semicolons, and trailing commas.

## Tests

Run the full suite with `npm test`. It is fast, deterministic, and offline.

The suite is layered so that runtime assumptions are checked against the real
Pi host, not just hand-built fakes:

- **Unit / in-process** — most of `tests/`, including the `/goal`
  auto-continuation smoke (`npm test -- tests/e2e-smoke.test.ts`).
- **Real-runtime harness** (`tests/pi-runtime.e2e.test.ts`) — drives the
  extension against Pi's actual `SessionManager`, so `sessionId`, `leafId`, and
  `getBranch` behave like a live session. Runs as part of `npm test`.
- **Live end-to-end** (`tests/pi-live.e2e.test.ts`) — launches a real Pi
  session with a real model and completes a goal through the tools. It is
  opt-in (needs a configured provider and makes billable model calls) and is
  skipped by default. Run it before cutting a release:

  ```bash
  npm run test:e2e-pi
  ```

When adding fakes for the Pi context, keep them adversarial (advancing
`leafId`, no host-provided `goalProtocol`) rather than convenient — both
past runtime bugs slipped through fakes that were too forgiving.

## Commits

Use conventional commits, matching the existing history: `chore:`, `test:`, `docs:`, `ci:`, `fix:`, `feat:`, or `refactor:`.

## Pull requests


PRs should keep CI green, include focused tests for behavior changes, and add a `CHANGELOG.md` entry under `[Unreleased]` when user-facing behavior, tooling, CI, or docs change.

For Roadmap/Architecture work:
- PRs addressing roadmap items must indicate the **KPI(s) impacted** in the description.
- If claiming a performance improvement, attach the baseline, environment, and a reproducible benchmark.
- If changing diagnostic/tooling messages, update or add tests asserting the new noise/recovery rules.
