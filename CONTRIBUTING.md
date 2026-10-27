# Contributing to Loong

Read [development setup](docs/development.md), [architecture](docs/architecture.md), and [security boundaries](SECURITY.md) before making changes.

1. Reproduce the behavior with a minimal project or a deterministic test. State the desired behavior and how it will be verified.
2. Keep changes focused. Preserve user-owned files, keys, and project state. Do not add credentials, local data, generated installers, or model transcripts containing private content.
3. Add regression tests for behavioral fixes. Test observable outcomes rather than merely matching implementation text. Keep failed/skipped/unrun cases distinct.
4. Run `npm test`, `npm run build`, and the relevant smoke/evaluation checks. A desktop-boundary or native-runtime change needs real packaged validation on affected platforms.
5. Describe what changed, why, verification performed, and material limitations in the pull request. Do not claim a live model score from fixture or mock tests.

Changes to the agent loop must preserve legitimate read-only/no-op tasks, return real tool failures to the model, and distinguish completed from partial/blocked/failed work. Changes to model routing must preserve Fixed selection and explicit budget/cost boundaries. Changes to approvals must not turn silence, failed HTTP requests, or stale decisions into permission.

Update user documentation when a command, configuration field, behavior, platform prerequisite, or data format changes. Keep package and lockfile versions consistent. Propose large architecture/storage changes with compatibility and migration evidence before implementation.
