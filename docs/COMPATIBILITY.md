# Pi compatibility policy

`pi-thread-goal` supports an explicit, evidence-backed Pi range. Wildcard peer dependencies are not a compatibility claim.

## Tested matrix

Registry metadata was checked on 2026-07-15.

| Set | `@earendil-works/pi-coding-agent` | `@earendil-works/pi-ai` | `typebox` | Registry basis |
|---|---:|---:|---:|---|
| Maintained minimum | `0.74.2` | `0.74.2` | `1.1.24` | Pi's `legacy-node20` dist-tag and the TypeBox floor declared by that Pi release |
| Current | `0.80.7` | `0.80.7` | `1.1.38` | Pi's `latest` dist-tag and the exact TypeBox version declared by that Pi release |

The package peer ranges are `>=0.74.2 <=0.80.7` for both Pi packages and `>=1.1.24 <=1.1.38` for TypeBox. Versions outside those bounds are not supported until the matrix, peer ranges, and evidence advance together.

## What the matrix proves

`npm run test:packed` creates the same tarball that would be distributed, rejects files outside the package allowlist, and installs that tarball into a new temporary consumer for each compatibility set. Each consumer contains only its exact Pi/TypeBox set plus the tarball.

The smoke then:

1. loads `node_modules/pi-thread-goal` through the installed Pi extension loader;
2. verifies `/goal` and the protocol tools are registered;
3. creates a goal through `/goal`;
4. executes observe → progress → observe → prepare → complete against Pi's real in-memory `SessionManager` while advancing the real session leaf; and
5. asserts that no model registry or provider credential path was accessed.

This makes a missing packed runtime file, an incompatible Pi API, an undeclared runtime dependency, or an invalid peer combination fail before release.

Run one set with `npm run test:packed -- --set minimum` or `--set current`. With no `--set`, both sets run.

## Update cadence

Maintainers check the npm dist-tags and aligned dependencies weekly with dependency review and again before every release. The current set and peer upper bounds advance only in one PR that includes a successful packed matrix for the proposed versions. The maintained minimum is reviewed before every minor release and may be raised only with a documented support decision and successful replacement-minimum evidence.

## Release gate

Before changing any supported Pi or TypeBox bound, attach all of the following to the pull request or release preparation record:

- registry output establishing the exact proposed minimum/current versions and their aligned dependencies;
- successful `npm run validate:workflows` evidence;
- successful packed-extension smoke output for both resulting compatibility sets;
- the inspected `npm pack --json` allowlist result; and
- passing lint, typecheck, coverage, performance, and high-severity audit checks.

Do not change the documented supported range based only on source-checkout tests, and do not release when either packed consumer fails.
