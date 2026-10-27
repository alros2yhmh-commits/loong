# Troubleshooting

## `npm ci` fails at the Node version check

Install Node.js 24 LTS, open a new terminal, and check `node --version` and `npm --version`. Different terminal profiles may select different Node installations. Source execution requires Node 24 even though the built Electron sidecar targets Electron's embedded runtime.

## Native terminal or `node-pty` install fails

On Windows, install Python 3 and Visual Studio 2022 Build Tools with Desktop development with C++. On Linux, install Python 3, `make`, and a C++ compiler. Retry `npm ci` with the same lockfile. Do not install with `--ignore-scripts`: the native module may be missing.

If installation cannot write its cache, set npm's cache and node-gyp's development cache to writable task-specific locations. Do not change your home directory or disable package/TLS/checksum verification. A binary copied from another OS or architecture is not a valid fix.

After a successful install, run `npm run build` and `npm run smoke:bundle`. The bundle must carry both the node-pty JavaScript loader and the matching native runtime.

## Electron download fails

The first install downloads Electron. Check Internet/proxy allowlists for the official GitHub release distribution and redirects, disk space, and the install log. Use supported proxy settings. Avoid unofficial mirrors or disabled checksum/TLS validation as a workaround.

For cloud-only browser development, `ELECTRON_SKIP_BINARY_DOWNLOAD=1` can omit the optional desktop binary. That environment can build the web/agent assets but cannot honestly validate or package the desktop until the binary is installed.

## App opens but the agent is offline

Read `agent-startup.log` in `<Electron userData>/agent` (normally under the platform's Loong application-data directory). Logs may contain project output; redact them before sharing. Confirm the build includes `dist-agent/loong-agent.cjs` and matching native modules.

The packaged app uses a private loopback port and a per-launch token; the renderer loads from `loong://app`. Do not hardcode port 5274 into a custom renderer or allow all CORS origins. A development agent and a packaged agent can run on different ports. Use the supplied preload `apiBase` and token.

## Linux desktop cannot start in a container

A real desktop smoke needs a display such as Xvfb and the Electron runtime libraries. A restricted CI container may require `LOONG_DISABLE_SANDBOX=1` for the test process; that weakens Chromium isolation and is not the default release setting. A passing headless API check does not establish that Electron rendered successfully.

## Windows warns about the Setup

Unsigned prereleases may trigger SmartScreen. Verify the download source and release checksum. A code-signed production release requires a valid signing certificate and an actual signature check; a checksum file is not a signing certificate.

## The model list is empty

Confirm the selected provider and network access. Ollama lists local models only and needs its local daemon. OpenRouter and direct-provider catalogs need access to their catalog endpoints. You may enter an exact supported model ID if the catalog is unavailable. Choose a model capable of tool calls for Agent mode.

## OpenRouter returns 429, an empty response, or an unavailable model

Free pools have shared capacity and usage limits. Inspect the task's provider error, retry state, and actual model. Fixed mode preserves a chosen model; Auto can use compatible alternatives according to policy. A larger prompt cannot increase quota. Configure a different compatible model or resume after capacity becomes available; do not treat a capacity error as task completion.

## Loong only answers or plans

Check both mode and permissions. Ask has no project tools; Plan is read-only. Agent is the implementation mode. Ask first can pause a protected action until its approval reaches the server. Check for a pending approval, a denied/expired decision, a missing folder, or a blocked task outcome.

If the task stops partially, inspect the explicit reason and remaining requirements rather than merely repeating a stricter prompt. Include the Loong version, model ID, mode, permission setting, redacted error, and a minimal project when reporting a reproducible issue.

## A check passed before the latest edit

A check applies to a particular file state. After a later edit, rerun the relevant check. The evidence panel may mark an earlier result outdated. A green status from an older run is not proof of the current change.

## Undo cannot restore a file

Undo cannot safely overwrite a newer user edit. Review the reported conflict and recover manually from the journal or version control. Shell commands, deployments, pushed Git commits, and external effects are not fully reversible through a file journal. Keep normal project backups/version control.
