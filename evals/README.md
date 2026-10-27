# Loong functional evaluation

This is a **small internal regression suite**, not a SWE-bench score, a leaderboard submission, or proof of parity with another product. The 30 repository tasks exercise seeded bugs and bounded features in files, async code, configuration, security helpers, streaming, and multiple modules. Both Arabic and English requests are included. They do not measure every skill needed for large production projects.

## Validate the evaluation harness offline

```sh
npm run eval:list
npm run eval:check
```

`eval:check` creates fresh temporary Git repositories, runs independent functional validators against the intentionally broken fixtures, then applies known-good reference solutions and validates again. A correct harness reports 30 passing self-tests. **This is not a language model's success rate.** No provider request is made.

Every acceptance validator executes outside the task's writable root. Its checks cover multiple observable cases and do not depend on an agent saying "done" or altering its own `npm run check` command. The fixture's public check only checks module syntax; the task asks the agent to add and run functional tests. Acceptance checks remain independent.

This separation prevents ordinary workspace file tools from editing acceptance files. It is not an OS sandbox against an unrestricted process running as the same user; use an isolated runner for untrusted agents or third-party code.

## Run an actual agent

Select a currently available tool-capable model. Supply the provider credential securely as an environment variable, not a command-line argument. `LOONG_PROVIDER_API_KEY` works for any provider; the provider-specific names supported by headless execution also work. Keys are not included in result JSON.

```sh
# POSIX: configure LOONG_PROVIDER_API_KEY in your environment first.
npm run eval -- --task clamp-boundaries --provider openrouter --model <model-id> --steps 60 --timeout 300

# Run all 30 tasks; this makes real requests and consumes provider quota.
npm run eval -- --task all --provider openrouter --model <model-id> --repetitions 3
```

On PowerShell, set `$env:LOONG_PROVIDER_API_KEY` securely in your session and use the same npm commands. Ollama needs no key. A custom compatible provider accepts `--provider custom --base-url http://127.0.0.1:<port>/v1`.

All runs pin `route:manual`; a hand-selected model is not silently changed. Each task runs in a new disposable repository with a unique report ID. `--output <directory>` changes the artifact directory, and `--keep-workspaces` retains temporary workspaces for diagnosis. Otherwise task workspaces are removed after acceptance; patches and JSON reports remain in `tmp/evaluations/<unique-run-id>/` (ignored by Git).

Each result records the requested and actual model, runtime outcome, functional acceptance, failed tools, tokens when available through runtime reporting, time, and a final patch. Success requires **both** runtime `completed` and acceptance passing. A provider failure remains visible as its own runtime failure rather than being silently dropped from the denominator. There is no automatic free-to-paid model fallback.

Exit codes: `0` all selected checks/tasks passed; `1` at least one failed; `2` invalid invocation or harness error. `--help` lists available commands. No live result is claimed until the corresponding run is performed.

## Fair comparisons

1. Pin the Loong commit, model, provider, task IDs, budgets, repetitions, and environment.
2. Compare old and repaired Loong on the same model first. Then compare model strength using the repaired runtime.
3. Retain a separate held-out task set for release decisions; do not tune prompts on all public fixtures and call the result general capability.
4. Report first-attempt functional success, consistency across repetitions, false completion, provider availability, time, and total cost including failed runs. Do not infer dollar cost from token count alone.
5. Public suites such as SWE-bench Verified and Terminal-Bench/Harbor need their own official harness adapters and resources. This runner does not claim those integrations are implemented.
