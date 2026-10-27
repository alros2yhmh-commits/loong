# Use Loong

## Open a project

The project folder is the boundary for file tools. Open it through the desktop picker before asking the agent to edit files. Existing sessions retain their project association. A home directory is usually too broad a workspace; select the specific repository.

## Configure a provider

Use Settings → API keys. The renderer can submit a key and read its masked status, but it cannot retrieve the stored plaintext key through the settings API. Custom endpoints also need a base URL. Configure proxy/firewall access for the provider you actually use.

For OpenRouter, choose a tool-capable model from the provider catalog or enter an exact supported model ID. A free model can be rate-limited, temporarily unavailable, or incapable of a difficult task. Capacity errors and model-quality errors are different problems. Changing a model can improve its reasoning capability, but it does not replace inspecting the resulting code.

For Ollama, start Ollama separately, pull a tool-capable model, and select it in Loong. The default endpoint is `http://127.0.0.1:11434`; `LOONG_OLLAMA` overrides it in the agent's environment.

**Fixed** retains the selected model. **Auto** permits compatible fallback according to the provider policy. Loong's selected model, the actual model reported by the provider, and provider fallback are distinct concepts. Free-model fallback is restricted to the free pool; do not enable paid routing without an intentional budget decision.

## Modes and permissions

| Setting | Behavior |
| --- | --- |
| Ask | Conversation without project tools |
| Plan | Read and plan without code edits or command execution |
| Agent | Supported project tools, subject to permissions |
| Ask first | Protected operations wait for approval |
| Full trust | Supported protected operations may execute within the authorized project |

Full trust is a permission choice, not a different model, and does not remove filesystem/network guards. Plan mode remains read-only. Select Agent to implement a plan. Review the exact command, files, or destination on an approval card. A failed approval request can be retried; do not interpret a local button press as confirmation that a command already executed.

## Give a useful task

Describe the desired behavior and how it can be checked. Include constraints such as preserving an API or supporting an existing framework. Arabic and English prompts are supported. Large tasks benefit from explicit acceptance criteria, for example:

> Add persistent task storage to this app. Keep the existing UI and public API. Handle corrupt saved data without losing the current in-memory task list. Add a regression test and run the project's test and build commands.

Loong should inspect relevant files, implement the change, and run applicable checks. A question or review need not modify files. A task that is already satisfied can be a legitimate no-op when supported by evidence.

## Review evidence

Changes shows file diffs. Checks shows commands and their outcomes. A passing check applies to the files it exercised; a later edit can make an earlier check outdated. Terminal shows process output, which may contain sensitive project data. The conversation summarizes progress but is not itself proof that code works.

Task outcomes distinguish completed, partial, blocked, failed, cancelled, and budget exhaustion. Read the reason when work stops. Missing credentials, a denied approval, exhausted capacity, a failed check, and an unfinished implementation require different next steps.

Do not publish generated changes until you have reviewed the diff and the relevant checks. Undo is a recovery aid; it cannot reverse arbitrary external effects of shell commands, Git pushes, deployments, or network calls.

## Data and privacy

The app stores local sessions, settings, traces, journals, and keys under its data directory. Desktop provider keys are encrypted with an OS-keychain-wrapped installation key when a usable keychain is available. Headless/keychain-unavailable fallback is explicitly labeled; a locked protected store is preserved. Loong sends the selected context to your chosen model/provider, and external tools may contact their own endpoints. Review provider privacy and retention policies for confidential repositories. Do not include keys in screenshots, issue reports, prompts, or commits.

See [security boundaries](../SECURITY.md) and [troubleshooting](troubleshooting.md).
