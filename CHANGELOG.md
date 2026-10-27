# Changelog

## 3.0.0-beta.2

- Fix native Node24 development startup by avoiding non-erasable TypeScript parameter properties.
- Add a real native entrypoint health/shutdown regression test, independent of tsx and the bundled desktop runtime.

## 3.0.0-beta.1

- Agent results distinguish completed, partial, blocked, cancelled, failed, and budget-exhausted work. Project checks and bounded repairs run before completion.
- All registered tools share permission, hook, lease, and execution-state handling. Read-only implementation attempts and unfinished plans cannot silently pass completion.
- Model-aware context assembly retains original requirements and provider protocol metadata. Tool discovery reduces initial schema overhead; fixed model selection and free-only fallback are explicit.
- Durable run journals allow UI reconnection/replay without rerunning tools; process restarts block unknown outcomes for inspection.
- Task workspace adds Changes, Checks, Terminal, Artifacts, scoped conflict-aware undo, approval retries, and Arabic bidirectional layout support.
- Batch edits, deletion snapshots, rewind conflicts, hook stdin handling, and command guards have regression coverage.
- Headless evaluation preserves the Git index and reports truthful outcomes. Thirty internal fixtures include independent acceptance checks; fixture self-tests are not a live model benchmark.
- Desktop provider credentials use OS-keychain-backed authenticated encryption where available, with explicit fallback status and preservation of locked stores.
- Removed unused AG-UI client/protobuf dependencies and their vulnerable validator path; JSON SSE transport remains interoperable.
- Desktop uses an authenticated private loopback port and exact trusted renderer origin. Electron is pinned to 44.9.3 with Node24, with native PTY and desktop smoke checks.
- Windows NSIS and Linux AppImage CI, integrity checksums, and English/Arabic source-build documentation are included.

This prerelease does not establish live-provider benchmark parity, a complete OS sandbox for shell commands, or signed Windows releases. See docs/validation.md for evidence and platform limits.
