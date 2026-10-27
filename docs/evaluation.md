# Evaluate Loong

Passing unit tests establishes specific runtime behavior. It does not establish that a particular model can solve real tasks, nor does it establish parity with Claude Code or another product.

## Three different checks

| Check | What it demonstrates |
| --- | --- |
| `npm test` | Deterministic tool/runtime/UI-state regressions |
| `npm run eval:check` | Evaluation fixtures and independent validators behave as expected |
| A live evaluation run | An identified model and Loong commit attempted selected tasks under a defined budget |

```bash
npm run eval:list
npm run eval:check
npm run eval -- --help
```

Use the evaluator's printed help for supported task-selection, provider/model, timeout, and output arguments. Configure live credentials through its supported environment-variable mechanism; never put a real key in a command-line argument, trace, fixture, or committed file. Consult `evals/` for the task manifest and fixture/validator definitions.

## Reproducibility

Freeze the repository commit, model ID, provider routing policy, dataset version, task subset, time/step/context budget, and operating system. Use an independent fresh task workspace. Validators must live outside the agent-writable project so an agent cannot make a task pass by rewriting the checker.

Keep full results for passed, failed, partial, blocked, cancelled, and unrun tasks. A fixture self-check is not a live agent score. A provider outage is distinct from an incorrect patch, but should remain visible in the end-to-end result. Track side effects, independent check results, model/cost/tokens, and elapsed time.

## Causal comparison

First compare the old and repaired Loong harness using the **same model and budget**. Repeat representative tasks to estimate variance. Then compare a free model with a stronger reference model on the repaired harness. A product comparison against Claude Code uses different model/access assumptions and should be reported separately.

Keep held-out tasks that were not used to tune prompts. Include Arabic and English requirements, multifile edits, regressions, failing-test repair, long context, approval failure, reconnect, and recovery. Measure functional task success, false completion, cost per successful task including failed attempts, repeatability, and p50/p95 duration. Review outcomes with tests and human inspection; prose-only grading is insufficient.

## Public benchmarks

[SWE-bench](https://github.com/SWE-bench/SWE-bench), [Terminal-Bench](https://github.com/laude-institute/terminal-bench), and [Harbor](https://github.com/laude-institute/harbor) provide reproducible external evaluation workflows. Run their official harnesses with a documented Loong adapter and independent validators. Start with a predeclared sample if resources are limited. Do not present a subset result as a full leaderboard score, or reuse cached result IDs after changing the patch.

No public benchmark score or commercial-agent parity is asserted by this documentation. Publish actual run artifacts and limitations when such evaluation is performed.
