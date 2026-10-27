# Validation of 3.0.0-beta.1

This file records executed checks separately from planned or externally blocked checks. Re-run them for the exact release commit; saved reports or earlier artifacts are not evidence for later changes.

## Checks executed during development

- Linux Node24: full automated suite passed (391 tests at the recorded baseline; later regression additions are counted by the current runner).
- Frontend and server TypeScript checks and production renderer/agent build passed.
- Real local provider fixture: a background task wrote a real file, completed its independent project check, survived stream cancellation, and replayed without another model request or file write. This is a deterministic provider fixture, not a live model quality score.
- Explicit cancellation resolved a parked approval without writing; broker UUIDs match.
- Chromium UI smoke passed model selection, Arabic direction, failed-approval retry, partial outcome, stale checks, file preview, keyboard tabs, scoped undo, and disconnect/replay. No external AI request was sent.
- Electron44.9.3 / embedded Node24.22.0: trusted loong://app renderer reached its authenticated dynamic-port API; native PTY passed. Restricted CodeAct tests also passed under the embedded runtime.
- Evaluation harness self-test rejected all30 broken baselines and accepted all30 reference solutions. No model success score is inferred.

## Build artifacts and limits

Linux AppImage and packaged-desktop startup are tested locally when the packaging checks pass. See the corresponding CI job and checksum for the exact build. A cross-built Windows unpacked application was inspected for correct PE/x64 and native Windows assets; that does not establish Windows execution or installer validation.

Native Windows CI builds the NSIS Setup and runs packaged desktop smoke. Review its actual result in GitHub Actions. A workflow definition alone is not a successful job. The onboarding network denied api.github.com, so CLI access to Actions metadata was unavailable; Git pushes and public repository pages worked.

Beta installers are unsigned unless a signing certificate has been explicitly configured. No live OpenRouter quality benchmark or competitor-parity evaluation was run, because no provider credential/budget was supplied for those calls. Shared free endpoints also have availability/usage limits.

For untrusted code, use an external VM/container/account boundary. Local command guards and Node's restricted CodeAct process do not sandbox all arbitrary shell commands.
