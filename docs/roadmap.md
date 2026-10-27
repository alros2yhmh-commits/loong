# Implementation status and follow-up

The 3.0 beta turns the audited failure modes into tested runtime behavior. It is a usable development release, not a claim of enterprise certification or equivalence to a flagship model.

| Area | Beta status |
| --- | --- |
| Unified tool execution and truthful outcomes | Implemented with integration regressions |
| Verification and bounded repair before completion | Implemented |
| Context compaction, tool discovery, fixed/free routing | Implemented and protocol-tested |
| Durable events, reconnect/replay, interrupted-run recovery | Implemented; unknown external effects require reconciliation |
| Evidence UI, approval ACK/retry, Arabic layout, safe scoped undo | Implemented and Chromium-tested |
| Desktop origin/token transport and native packaging | Implemented; platform evidence in validation.md |
| Internal evaluation fixtures and headless adapter | Implemented; live runs require provider access and budget |
| OS containment of arbitrary shell commands | Not provided; use an isolated VM/container/account for untrusted projects |
| Flagship model/competitor benchmarks | Not run; use documented fixed-model evaluation before making claims |
| Code signing, organization SSO/RBAC, centralized policies | Separate release/team deployment prerequisites |
| Writing subagents and broad autonomous parallel changes | Deferred until single-agent evaluation justifies their cost and isolation design |

Public benchmark work should use the official SWE-bench/Terminal-Bench harnesses on pinned datasets and independent fresh environments. Report exact subsets, model IDs, budgets, repetitions, and failures. Do not convert a fixture self-test or a subset score into a product-parity claim.

Keep React/TypeScript/Hono/Electron unless measured needs justify a migration. Add indexing, integrations, and parallel agents in response to real task failures rather than feature count.
