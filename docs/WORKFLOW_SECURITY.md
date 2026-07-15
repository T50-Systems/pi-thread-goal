# Workflow supply-chain policy

GitHub-hosted automation executes third-party code before repository tests run. Every non-local `uses:` reference in `.github/workflows/*.yml` is therefore pinned to a reviewed full commit SHA. A trailing release-version comment keeps the immutable pin understandable to reviewers and Dependabot.

## Reviewed pins

| Action | Release | Commit SHA | Publisher |
|---|---|---|---|
| `actions/checkout` | [`v5.0.1`](https://github.com/actions/checkout/releases/tag/v5.0.1) | `93cb6efe18208431cddfb8368fd83d5badbf9bfd` | GitHub (`actions`) |
| `actions/setup-node` | [`v5.0.0`](https://github.com/actions/setup-node/releases/tag/v5.0.0) | `a0853c24544627f65ddf259abe73b1d18a591444` | GitHub (`actions`) |
| `actions/upload-artifact` | [`v4.6.2`](https://github.com/actions/upload-artifact/releases/tag/v4.6.2) | `ea165f8d65b6e75b540449e92b4886f43607fa02` | GitHub (`actions`) |

The table records the reviewed state as of 2026-07-15. The workflow files remain the enforced source of truth.

## Offline validation

Run:

```bash
npm ci
npm run validate:workflows
```

The validator uses the lockfile-pinned MIT `actionlint` WebAssembly package to check workflow structure, contexts, expressions, permissions, events, and job/step contracts without network access. It also parses every Bash `run:` block with local `bash -n`; validation fails closed when Bash is unavailable or when a future workflow selects an unsupported shell. A repository policy layer rejects mutable remote action tags/branches and pins without a release-version comment. Local `./...` actions are allowed; remote reusable workflows must use the same full-SHA form.

`actionlint`, `yaml`, and the validator are development-only tooling. They are not imported by the extension runtime and are excluded from the published package allowlist. `bash` is therefore a documented local validation prerequisite and is already present on the Ubuntu GitHub-hosted runner.

The pinned WebAssembly build predates actionlint's recognition of GitHub's valid top-level `vars` context. The wrapper suppresses only that exact `undefined variable "vars"` compatibility diagnostic; expression parsing and all other context diagnostics remain enabled. The repository's release workflow exercises the exception, and malformed-expression fixtures ensure the parser still fails closed. Remove the exception when the pinned backend recognizes `vars`.

## Advancing a pin

1. Let Dependabot open the GitHub Actions update or identify an upstream release from the official `actions/*` repository.
2. Review release notes, publisher ownership, changed permissions/inputs, and the tag-to-commit mapping. Do not trust a copied SHA without checking the official repository.
3. Keep the full lowercase 40-character SHA and update the trailing release comment and this table together.
4. Run `npm run validate:workflows`, lint, typecheck, tests, audit, and package dry-run locally.
5. Merge only after the pinned action executes successfully in read-only pull-request CI. Release-workflow permission changes require separate security review; never add secrets to pull-request jobs.

To verify a tag mapping with GitHub CLI:

```bash
gh api repos/actions/checkout/git/ref/tags/v5.0.1 --jq '.object.sha'
```

If upstream uses an annotated tag, resolve the returned tag object to its commit before recording the pin.
