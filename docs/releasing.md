# Build and publish a release

A source commit, a successful CI artifact, and a published release are separate states. Publish only artifacts produced by a successful run for the exact release commit.

## Before tagging

1. Update `package.json` and `package-lock.json` together. Use a prerelease version such as `3.0.0-beta.1` while validation or support commitments are incomplete.
2. Run tests, evaluation harness self-check, build, bundle smoke, and real desktop smoke. Verify the Windows installer on Windows and the Linux package on Linux.
3. Review model routing, permission changes, data migrations, native binaries, and dependency licenses. Never add a key, private project, local data directory, or signing certificate to Git.
4. Record actual platform outcomes and known issues in the release notes. Live model scores require an identified model, dataset, budget, commit, and independent validators.

## Build locally

Windows PowerShell:

```powershell
npm ci
npm test
npm run eval:check
npm run build:exe
npm run smoke:bundle
npm run smoke:runtime
node scripts/smoke-desktop.mjs --packaged app/win-unpacked/Loong.exe
npm run checksums
```

Linux:

```bash
npm ci
npm test
npm run eval:check
npm run build:linux
npm run smoke:bundle
npm run smoke:runtime
node scripts/smoke-desktop.mjs --packaged app/linux-unpacked/loong
npm run checksums
```

A Linux headless runner uses Xvfb for the real desktop smoke. Avoid disabling Chromium's sandbox for normal user launches. Any test-only override must remain explicit in CI.

## GitHub Actions

`.github/workflows/ci.yml` runs on pushes to `main`, pull requests, and manual dispatch. It validates Linux and Windows and uploads installer/AppImage artifacts and checksum files. Inspect every required job; the presence of a workflow file is not evidence of successful execution.

`.github/workflows/release.yml` runs only when a version tag is pushed. The tag must exactly match `v` plus `package.json`'s version. Each platform rebuilds and checks the package, then a separate job creates the GitHub release with generated notes and a combined `SHA256SUMS.txt`. Tags with a hyphen publish as prereleases.

Example, only after the release commit has passed:

```bash
git tag -a v3.0.0-beta.1 -m "Loong 3.0.0 beta 1"
git push origin v3.0.0-beta.1
```

Do not move a published tag or replace its artifacts silently. Issue a new patch/prerelease for a corrected build.

## Artifact integrity and signing

Generate checksums with `npm run checksums`. Verify on Windows:

```powershell
Get-FileHash .\Loong-3.0.0-beta.1-Setup-x64.exe -Algorithm SHA256
```

Compare the result against the same release's `SHA256SUMS.txt`. This detects a mismatched/corrupted download, but does not authenticate the publisher if both files came from an untrusted location.

The default beta workflow does not include a code-signing certificate. For a signed Windows release, configure electron-builder's supported certificate credentials securely in CI and verify the resulting Authenticode signature. Certificate enrollment, reputation, secrets, and platform-specific notarization are release prerequisites that cannot be manufactured from source code. Do not describe an unsigned installer as signed.

## Rollback and data

Keep prior release artifacts available and preserve application data before upgrading. If a migration is introduced, make a recoverable backup before it runs and document whether the previous app can read the new data. Reinstalling an older binary cannot reverse arbitrary changes the agent made to user projects or external services.
