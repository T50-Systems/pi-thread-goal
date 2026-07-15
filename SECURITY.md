# Security Policy

## Supported versions

Security fixes are provided for the latest tagged minor release. Maintainers may ask reporters to reproduce against `main` when a fix has already landed but is not yet released. Older minors do not receive separate fixes; upgrade to the newest release before requesting support.

| Version | Supported |
|---|---|
| Latest tagged minor | Yes |
| Older minors | No |

## Private reporting

Report suspected vulnerabilities through [GitHub private vulnerability reporting](https://github.com/T50-Systems/pi-thread-goal/security/advisories/new). If that form is unavailable, contact the repository maintainers privately through their GitHub profiles and ask for a secure disclosure channel before sharing details.

Do not put vulnerabilities, proof-of-concept payloads, tokens, session transcripts, provider responses, credentials, or other secrets in a public issue, discussion, pull request, or log. Expect an acknowledgement within seven days. Coordinated disclosure timing depends on severity, validation, and release readiness.

## Trust boundaries and threat model

### Pi session entries

Goal state is event-sourced from custom entries in the active Pi session branch. The extension treats entries as local persisted input, validates reconstructed state and mutation contracts, and scopes capabilities to the observed goal revision. Anyone or any extension able to modify a session can influence reconstructed goal state. Session files and transcripts may contain sensitive objectives, paths, progress, evidence, and model content; protect them with the same access controls as the rest of the Pi session.

### Evaluator provider calls

For an active goal, the configured evaluator model provider receives the rendered evaluation prompt. That prompt includes the goal objective, acceptance criteria, current blockers, and current-work text when present. Provider credentials and transport are managed by Pi and its model registry, not persisted by this extension. Review the configured provider's retention and data-use terms before placing confidential information in those fields.

The full Pi session history, raw session-entry store, source paths, usage counters, completed-work list, progress summary, and ordinary conversation remain in Pi session state and are not included by `pi-thread-goal` in the evaluator prompt. Pi, the primary model, the configured provider, or another extension may independently process session data; those are separate trust boundaries.

### Environment configuration

`GOAL_EVALUATOR_MODEL` and `GOAL_EVALUATOR_TIMEOUT_MS` affect provider selection and evaluator timing. Environment values are trusted operator configuration. The extension does not need application secrets of its own and must never log provider API keys. Restrict who can change the process environment and inspect CI logs before sharing them.

### Tool and host capabilities

The extension registers goal-state tools and a `/goal` command. Goal tools can append session entries only after protocol observation and revision checks; user commands can create, edit, pause, resume, complete, dismiss, replace, or clear goal state. The extension can queue follow-up user messages through Pi, update UI elements, read the active branch, and call the configured evaluator provider. It does not itself grant filesystem, shell, network, deployment, or billing authority, but the primary Pi agent may have those capabilities. A goal must not be treated as authorization for sensitive actions: host policies and explicit user approval still apply.

### GitHub Actions supply chain

Repository workflows execute only reviewed remote actions pinned to full commit SHAs. `npm run validate:workflows` checks workflow semantics and rejects mutable remote references before merge; the same command runs in pull-request CI with read-only repository permissions. Dependabot may propose SHA updates, but maintainers must verify publisher ownership, official release notes, permissions, and tag-to-commit provenance using [`docs/WORKFLOW_SECURITY.md`](docs/WORKFLOW_SECURITY.md). Release publication retains a separate opt-in boundary and must never expose `NPM_TOKEN` to pull-request jobs.

## Maintainer response

Maintainers will validate the report, assess affected versions, coordinate a fix and tests, and publish release notes without exposing reporter data. Dependency alerts are reviewed alongside weekly npm and GitHub Actions update checks.
