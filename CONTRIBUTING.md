# Contributing

## Development setup

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
