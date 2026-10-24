# LOONG — Tooling Research & Selection

**Status:** verified shortlist. Every claim below was checked against a live
source on 24 Oct 2026. Nothing was installed before being scored.

## 1. What the repository already provides (verified)

`package.json` survives intact and `node_modules` is present (502 packages).
That fact eliminated most of the shopping list before research began:

| Need | Already installed | Version |
|---|---|---|
| UI runtime | `react` + `react-dom` | 19.3.1 |
| Language | `typescript` | 5.7.2 |
| Build | `vite` + `@vitejs/plugin-react` | 6.0.7 / 4.3.4 |
| Styling | `@tailwindcss/vite` | 4.3.3 |
| **Animation** | **`motion`** (Framer Motion) | 14.3.0 |
| Markdown | `react-markdown` + `remark-gfm` + `rehype-sanitize` | 10.1.0 / 4.0.1 / 6.0.0 |
| Agent protocol | `@ag-ui/core` `@ag-ui/client` `@ag-ui/encoder` | 1.0.3 |
| Model SDK | `ai` + `@ai-sdk/*` | 7.0.142 |
| Server | `hono` + `@hono/node-server` | 4.13.13 |
| Terminal | `node-pty` | 1.1.0 |
| **UI verification** | **`playwright-core`** | 1.64.1 |
| Image diffing | `pngjs` + `pixelmatch` | 7.0.0 / 5.3.0 |
| Tests | `node:test` + `tsx` | — |

**Consequence: phases 1–5 of the plan need zero new runtime dependencies.** The
only genuine gaps are Shiki (phase 6, syntax highlighting) and xterm.js (phase
6, the terminal pane), and neither is needed before the run works end to end.

---

## 2. Skills

### 2.1 Emil Kowalski's skills — **INSTALL NOW (one of them)**

| Candidate | Source | Licence | Verdict |
|---|---|---|---|
| `animate-skill` | `github.com/delphi-ai/animate-skill` — "Claude Code skill for Next.js/React animations based on Emil Kowalski's course" | public repo | **Install.** Emil Kowalski is the author of *Animations on the Web* and the former Vercel design engineer; his rules are exactly the restraint `ui-motion-spec.md` asks for. |
| `emil-design-eng` | `github.com/emilkowalski/skills`, installable with `npx skills add https://github.com/emilkowalski/skills --skill "emil-design-eng"` | public | **Install.** Design-engineering critique: layout, typography, hierarchy, spacing, and killing generic AI slop. This is the "eliminate generic design" requirement, from the person who defined the standard. |
| `apple-design` | same repo | public | **Use when needed.** Valuable for the title bar and the pane choreography; not needed for the first slice. |
| `taste-skill` | `github.com/big-data-ai/taste-skill` (fork of `Leonxlnx/taste-skill`), "The Anti-Slop Frontend Framework for AI Agents", sponsored by Emil Kowalski / animations.dev | public | **Use when needed.** Overlaps `emil-design-eng`. One critic, not two. |

**Scored** (relevance / quality / compatibility / free / ease / maintenance / benefit):

| Skill | R | Q | C | F | E | M | B | Total |
|---|---|---|---|---|---|---|---|---|
| `animate-skill` | 5 | 5 | 5 | 5 | 5 | 4 | 5 | **34** |
| `emil-design-eng` | 5 | 5 | 4 | 5 | 5 | 4 | 5 | **33** |
| `apple-design` | 3 | 4 | 4 | 5 | 4 | 4 | 3 | 27 |
| `taste-skill` | 4 | 4 | 3 | 5 | 4 | 3 | 3 | 26 |

### 2.2 Frontend-design skills

`frontend-design` and Vercel's Agent Skills were considered and **rejected for
now**: `emil-design-eng` already covers design critique, and the design spec is
written and approved — a second design skill would argue with it. Revisit only
if the critique pass finds the spec itself wanting.

---

## 3. MCP servers

| Server | What it does | Free? | Account/key? | Verdict |
|---|---|---|---|---|
| **Context7** | current library documentation pulled into context | free tier | no key for the public server | **Use when needed.** Valuable when a library API is uncertain. LOONG's stack is pinned and read from the installed `node_modules`, so its value here is low. |
| **Chrome DevTools MCP** (`ChromeDevTools/chrome-devtools-mcp`, Google) | drives a real browser over CDP: console, network, screenshots, performance traces | fully free, open source | no | **Use when needed** — but see below. |
| **Playwright MCP** (`@playwright/mcp`, Microsoft) | cross-browser automation exposed as MCP tools | fully free, open source | no | **Reject for now.** `playwright-core` is already installed and `scripts/audit-ui.mjs` + `scripts/contrast.mjs` already drive **the packaged Electron app itself over CDP** — stronger evidence than a browser MCP, because it inspects the real product rather than a page that resembles it. |
| shadcn MCP | component registry over MCP | free | no | **Reject.** shadcn's opinions are the generic look the design spec explicitly forbids. |
| 21st.dev Magic MCP | generates UI from prompts | limited free tier, account required | **yes** | **Reject.** It produces generic AI UI, and an account dependency is exactly what the brief says not to accept. |
| Figma / Penpot / Paper | design canvas | free tiers / OSS | account | **Reject for now.** No designer is in the loop; the spec is the design. |

**Scored:**

| MCP | R | Q | C | F | E | M | B | Total |
|---|---|---|---|---|---|---|---|---|
| Chrome DevTools MCP | 4 | 5 | 4 | 5 | 4 | 5 | 3 | 30 |
| Context7 | 3 | 4 | 4 | 4 | 4 | 4 | 3 | 26 |
| Playwright MCP | 3 | 5 | 4 | 5 | 4 | 5 | 1 | 26 |

**Decision: install nothing from this list yet.** LOONG already owns a stronger
verification path. Chrome DevTools MCP becomes interesting only if a defect
appears that the CDP scripts cannot explain.

---

## 4. Component and visual references

Used as reading, not as code:

| Reference | What LOONG takes |
|---|---|
| `cc-haha` Claude Code desktop clone (`gitcode.com/gh_mirrors/cl/cc-haha`) | its pixel spec informed the earlier build; superseded by the official research, which corrected two of its assumptions |
| `HenryMu/claude-libre` | multi-session desktop structure over the CLI |
| `siteboon/claudecodeui`, `thomascherickal/claudecodeui` | web layout for session and project management |
| OpenCode | agent architecture, not UI |

No proprietary Claude assets, logos or exact branded layout are copied. The
interaction patterns are documented behaviour; the visual system is LOONG's own
monochrome.

---

## 5. Final selection

**Install now (2 skills, 0 MCPs, 0 new runtime dependencies):**
1. `animate-skill` — motion discipline
2. `emil-design-eng` — design critique

**Use when needed:** `apple-design`, Context7, Chrome DevTools MCP.

**Reject:** Playwright MCP (superseded by the existing CDP probes), shadcn MCP,
21st.dev Magic, Figma/Penpot/Paper, `frontend-design` and Vercel Agent Skills
(overlap with the approved spec).

**New runtime dependencies needed for phases 1–5: none.**
Phase 6 adds `shiki` and `xterm.js` — and only then.
