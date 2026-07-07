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

Run the full suite with `npm test`. The in-process E2E smoke test for `/goal` auto-continuation can be run directly with:

```bash
npm test -- tests/e2e-smoke.test.ts
```

## Commits

Use conventional commits, matching the existing history: `chore:`, `test:`, `docs:`, `ci:`, `fix:`, `feat:`, or `refactor:`.

## Pull requests

PRs should keep CI green, include focused tests for behavior changes, and add a `CHANGELOG.md` entry under `[Unreleased]` when user-facing behavior, tooling, CI, or docs change.
