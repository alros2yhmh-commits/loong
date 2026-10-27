# Security policy and boundaries

Loong is a local coding agent that can modify files and run commands. Its authority is consequential: shell processes run with the current operating-system account's permissions.

## Report a vulnerability

Use this repository's GitHub **Security → Report a vulnerability** flow when private reporting is enabled. Otherwise contact the maintainer through the contact information in `package.json` to arrange private disclosure. Do not publish API keys, private project content, exploit payloads containing secrets, or unredacted data files in an issue.

Include the exact commit/version, OS, deployment mode, affected boundary, reproduction, and observed impact. This beta does not promise an enterprise support SLA.

## Current defenses

- File tools operate inside a deliberately selected workspace and enforce protected-path/symlink checks.
- Protected actions are subject to the live run's permission policy; approvals use stable broker identities.
- The packaged local API uses a fresh per-launch token and loopback binding.
- The renderer loads trusted packaged assets through `loong://app`; Node integration is off, context isolation and renderer sandboxing are on, and privileged IPC validates the sender.
- Provider keys are retained by the agent process and are not returned by the settings API.
- Supported file edits are journaled; recovery should refuse conflicts with newer user edits.

These controls reduce risk. Path validation and command regexes do **not** form a complete OS sandbox, and Full trust does not protect against every malicious repository or model-selected command. Use a VM, container, or separate account for untrusted projects. Treat repository instructions, fetched pages, tool output, and third-party MCP annotations as untrusted data.

## Keys and local data

The current key store uses an owner-restricted local file; it is not encrypted at rest. Protect the data directory and backups. The desktop app normally stores agent data under `<Electron userData>/agent`; development defaults to `~/.loong`, or the explicitly configured `LOONG_DATA_DIR`.

Provider privacy and retention depend on the selected provider and routing configuration. Do not assume all endpoints offer zero retention. Logs, journals, prompts, diffs, and evaluation artifacts can contain project content. Redact secrets before exporting or sharing them.

## Release trust

Keep TLS and artifact verification enabled during dependency/download operations. Beta installers can be unsigned. SHA-256 checksums detect mismatches but do not replace Authenticode signing or a trusted download channel. Review Actions results and release provenance for the exact version. Use a separately configured certificate for signed Windows publication.

Do not expose the development API to an untrusted network. The `LOONG_DISABLE_SANDBOX=1` desktop override is for constrained test environments only and weakens Chromium's sandbox; it is not a recommended production setting.
