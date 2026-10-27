# Develop and build Loong

## Supported build environments

| Component | Runtime |
| --- | --- |
| Source development, scripts, and tests | Node.js 24.x LTS and npm 11 or later |
| Renderer | React, Vite, TypeScript; browser and Electron |
| Current desktop shell | Electron 44.9.3; its bundled Node runs the compiled CommonJS sidecar |
| Installer targets in CI | Windows x64 NSIS, Linux x64 AppImage |

Development executes `.ts` server entrypoints directly with Node 24. The pinned Electron 44.9.3 sidecar also runs Node 24. The desktop runtime is checked with `npm run smoke:runtime` rather than inferred from the development Node version. Keep runtime, native modules, and dependency security updates tested together; any persistence migration still needs packaged-app compatibility and data-recovery tests.

## Windows prerequisites

Install Git and Node.js 24 LTS. On machines without a matching `node-pty` prebuilt binary, install Python 3 and Visual Studio 2022 Build Tools with Desktop development with C++. `npm ci` must complete its native build; skipping install scripts produces an incomplete application.

```powershell
git clone https://github.com/alros2yhmh-commits/loong.git
cd loong
npm ci
npm test
npm run build
npm run smoke:bundle
npm run smoke:runtime
npm run desktop
```

The first Electron installation downloads a platform binary from its verified distribution. Keep TLS, checksum, and package verification enabled. If a proxy blocks it, configure supported proxy/network access instead of bypassing verification.

## Linux prerequisites

Use x86_64 Linux, Node 24, Python 3, `make`, and a C++ compiler. Electron needs the distribution's desktop runtime libraries. AppImage launch may require FUSE support. Headless desktop CI additionally uses Xvfb. Chrome/Chromium or Edge is needed for browser automation; `playwright-core` does not install a browser automatically.

```bash
npm ci
LOONG_WORKSPACE="$PWD" npm run dev
```

The UI is at Vite's printed address, normally `http://localhost:5273`. The agent API is loopback-only at `127.0.0.1:5274`. `localhost` may resolve to IPv6; use the printed URL. Browser development does not provide the native desktop folder picker.

## Isolate development data

Tests use throwaway data directories through `tests/preload.ts`. For manual work, set a separate data directory:

```powershell
$env:LOONG_DATA_DIR = Join-Path $env:TEMP 'loong-dev-data'
$env:LOONG_WORKSPACE = (Get-Location).Path
npm run dev
```

```bash
LOONG_DATA_DIR=/tmp/loong-dev-data LOONG_WORKSPACE="$PWD" npm run dev
```

Do not set a real project's data directory while running experiments that create or delete sessions. The packaged app normally uses `<Electron userData>/agent`; development defaults to `~/.loong`.

## Verification and packaging

```bash
npm test
npm run eval:check
npm run build
npm run smoke:bundle
npm run smoke:runtime
npm run smoke:desktop
```

`smoke:desktop` needs a desktop session. On Linux CI use `xvfb-run -a npm run smoke:desktop`; a restricted container may need `LOONG_DISABLE_SANDBOX=1` for that **test process only**. This override disables Chromium's process sandbox and is not a normal production launch setting.

Build Windows on Windows:

```powershell
npm run build:exe
node scripts/smoke-desktop.mjs --packaged app/win-unpacked/Loong.exe
npm run checksums
```

Build Linux on Linux:

```bash
npm run build:linux
node scripts/smoke-desktop.mjs --packaged app/linux-unpacked/loong
npm run checksums
```

`build:exe` and `build:linux` rebuild the renderer and sidecar first. Generated `dist/`, `dist-agent/`, and `app/` are ignored. The bundle builder copies the platform's `node-pty` runtime, including a locally compiled `build/Release` directory when a prebuild is unavailable. Do not cross-copy native modules between OS/architecture targets.

## Reproducible dependency changes

Use `npm ci` for ordinary installs. Change `package.json` and `package-lock.json` together only when intentionally changing a dependency; review install scripts and run the relevant tests. Keep the bundled-runtime compatibility check and native terminal smoke in the validation path.

See [release instructions](releasing.md) before tagging a version. No local command publishes a release unless you explicitly run a publish action.
