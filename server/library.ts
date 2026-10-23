/* ---------------------------------------------------------------------------
   The library.

   A model is good at a lot and shallow at the rest: the exact incantation for
   a git reflog, the difference between `COPY --chown` and a chmod layer, what
   a 304 is allowed to contain. The library is the depth, and it is read the
   way a person reads a manual — when the question comes up, not before.

   Level 1: the topic list travels in the prompt (a line each).
   Level 3: the body is read by the model, on demand, through a tool.

   Seeded into DATA_DIR on first read. A topic the user adds is never
   overwritten: the seed only writes files that do not exist.
   --------------------------------------------------------------------------- */

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { DATA_DIR } from './config.ts'

export interface Topic {
  id: string
  title: string
  /** one line, so the model knows whether to open it */
  summary: string
  body: string
}

const SEED: Record<string, { title: string; summary: string; body: string }> = {
  git: {
    title: 'Git — the operations that actually come up',
    summary: 'undo, reflog, rebase vs merge, conflicts, bisect, worktrees, recovering lost commits',
    body: `# Git

## Undo, by what you want back
- Last commit, keep the changes: \`git reset --soft HEAD~1\`
- Last commit, discard the changes: \`git reset --hard HEAD~1\`
- One file back to HEAD: \`git checkout HEAD -- path\` (or \`git restore path\`)
- A pushed commit: never reset. \`git revert <sha>\` — a new commit that undoes it.

## Reflog: the safety net
Every HEAD move is in \`git reflog\` for ~90 days. A "lost" commit is almost
always there: \`git reflog\` → find the sha → \`git reset --hard <sha>\` or
\`git cherry-pick <sha>\`.

## Rebase vs merge
- Rebase rewrites history: only on branches nobody else has.
- Merge preserves it: always safe.
- \`git rebase -i HEAD~N\` to squash/reword. A conflict: fix the file, \`git add\`,
  \`git rebase --continue\`; \`--abort\` returns to before.

## Find the commit that broke it
\`git bisect start; git bisect bad; git bisect good <sha>\` then test each
checkout; \`git bisect reset\` at the end. \`git log -S"text"\` finds when a string
appeared or vanished.

## Worktrees — two branches at once
\`git worktree add ../other-branch other-branch\` — no stashing, no cloning.

## Before you commit
\`git diff --staged\` is the only thing you are actually committing.`,
  },
  sql: {
    title: 'SQL — correctness before cleverness',
    summary: 'joins, NULL semantics, indexes, EXPLAIN, transactions, window functions, N+1',
    body: `# SQL

## NULL is not a value
\`NULL = NULL\` is UNKNOWN, not true. Use \`IS NULL\`. \`NOT IN (subquery)\` returns
nothing when the subquery contains a NULL — use \`NOT EXISTS\`.

## Joins
- INNER: both sides.
- LEFT: all left, NULLs on the right — a filter on the right table in WHERE
  silently turns it into an INNER join; put it in the ON clause.
- A row multiplied after a join usually means a missing DISTINCT or a
  one-to-many you did not expect. Check \`COUNT(*)\` before and after.

## Indexes
- An index on the column you filter and sort by; a composite index is used
  left-to-right, so (a, b) helps \`WHERE a\` and \`WHERE a AND b\`, not \`WHERE b\`.
- A function on the column (\`WHERE lower(email) = ...\`) skips the index unless
  the index is on the expression.
- Every index costs writes.

## Transactions
\`BEGIN; ... COMMIT;\` — and know the isolation level. A read-modify-write in two
statements is a race without a lock or \`SELECT ... FOR UPDATE\`.

## Performance
\`EXPLAIN ANALYZE\` (Postgres) is the only honest answer. A seq scan on a big
table is the usual culprit; an N+1 in the app is the other one — one query per
row, visible as a hundred queries in the log.`,
  },
  docker: {
    title: 'Docker — images that stay small and builds that stay fast',
    summary: 'multi-stage, layer order, .dockerignore, compose, volumes, debugging',
    body: `# Docker

## Layer order is build speed
Copy the lockfile and install BEFORE copying the source: a source edit then
does not re-run the install. \`COPY package*.json ./ && npm ci && COPY . .\`

## Multi-stage
Build in one image, run in another: the toolchain never ships.
\`FROM node:22 AS build ... FROM node:22-slim AS run COPY --from=build /app/dist /app/dist\`

## .dockerignore
\`node_modules\`, \`.git\`, \`dist\` — otherwise the context upload is slow and the
copy overwrites what the image installed.

## Debugging
- \`docker logs -f <c>\` — the app's own output.
- \`docker exec -it <c> sh\` — look inside.
- Exit code 137 = OOM kill. 1 = the process failed.
- \`docker run --rm -it <image> sh\` to test the image without the compose file.

## Volumes
A named volume outlives the container; a bind mount mirrors the host. On
Windows a bind mount of node_modules is slow — keep dependencies in the image.

## Compose
\`depends_on\` waits for START, not for READY. A healthcheck + \`condition:
service_healthy\` is the difference between a flaky stack and a working one.`,
  },
  http: {
    title: 'HTTP — status codes, caching, and what a request really says',
    summary: 'status semantics, cache headers, CORS, idempotency, retries, timeouts',
    body: `# HTTP

## Status, honestly
- 200 ok · 201 created (+ Location) · 204 no content
- 301 permanent (cacheable) · 302/307 temporary (307 keeps the method)
- 304 not modified: no body, only when the client sent a validator
- 400 malformed · 401 who are you · 403 you may not · 404 not found
- 409 conflict · 422 understood but invalid · 429 slow down (+ Retry-After)
- 500 we broke · 502 bad upstream · 503 unavailable · 504 upstream timeout

## Caching
\`Cache-Control: max-age=0, must-revalidate\` + \`ETag\` is the safe default for
anything dynamic. \`immutable\` only for hashed asset filenames.

## Idempotency
GET/HEAD/PUT/DELETE are idempotent; POST is not. A retried POST needs an
Idempotency-Key header and a server-side record, or it creates two orders.

## Retries
Retry 429 and 5xx with exponential backoff + jitter. Never retry 4xx (except
429) — the answer will be the same, and it is the client's fault.

## CORS
The browser sends OPTIONS first for non-simple requests; the server must answer
with Access-Control-Allow-Origin/Methods/Headers and 204. A wildcard origin
cannot be combined with credentials.

## Timeouts
Every client needs one. A request with no timeout is a thread parked forever.`,
  },
  testing: {
    title: 'Testing — what to test, and what a failing test means',
    summary: 'unit vs integration, flaky tests, arrange-act-assert, mocking, coverage lies',
    body: `# Testing

## The shape
Arrange, act, assert — one behaviour per test, a name that says the behaviour
("rejects an expired token"), not the function ("test auth 2").

## What to test
The boundaries and the decisions: parsing, validation, permissions, money,
state machines. Not getters. Not the framework.

## A failing test is information
- It fails only sometimes → time, order, or shared state. Fix the cause; never
  \`sleep\`.
- It fails after an unrelated change → the test was coupled to an
  implementation detail. Test the behaviour, not the calls.
- It cannot fail → it asserts nothing meaningful.

## Mocking
Mock the network and the clock. Do not mock the thing you are testing, and do
not mock a pure function — call it.

## Coverage
Coverage says what ran, not what is checked. 100% of a wrong assertion is
still wrong. Watch the uncovered BRANCHES, not the line percentage.

## Speed
A suite slower than a minute stops being run. Keep unit tests pure and fast;
put the slow ones behind a flag.`,
  },
  security: {
    title: 'Security — the mistakes that actually ship',
    summary: 'injection, secrets, authz vs authn, path traversal, SSRF, dependencies',
    body: `# Security

## Injection
Never build a query, a shell command or HTML by concatenation. Parameterised
queries; \`execFile\` with an argument array, not \`exec\` with a string; escape or
sanitise HTML at the boundary.

## Secrets
A secret in the repo is a secret published. Environment or an OS keychain, and
a \`.env\` in \`.gitignore\`. A secret that reached a commit is compromised — rotate
it, do not just delete the file.

## Authn vs authz
"Logged in" is not "allowed". Every endpoint that touches a resource checks
that THIS user may touch THIS resource — the check belongs next to the query,
not in the client.

## Path traversal
A path from a request is untrusted: resolve it, then verify it is still inside
the root (\`resolve(root, p).startsWith(root + sep)\`). Reject \`..\` after
normalisation, not before.

## SSRF
A URL from a user that the server fetches can reach localhost and the metadata
endpoint. Allowlist schemes and hosts, and refuse private ranges.

## Dependencies
\`npm audit\` is noisy but not wrong. Pin, update deliberately, and read what a
postinstall script does.`,
  },
  react: {
    title: 'React — state, effects, and the renders that surprise you',
    summary: 'state vs derived, effect deps, stale closures, keys, memo, StrictMode',
    body: `# React

## State is the minimum
Anything computable from state and props is derived — compute it in render, do
not store it. Two sources of truth drift.

## Effects
An effect is for synchronising with something OUTSIDE React (a socket, the
DOM, a timer). Deriving data does not need one. Every value the effect reads
goes in the dependency array, or the closure goes stale.

## Stale closures
A callback created once captures the values from that render. If it needs the
current value, put it in the deps — or read from a ref.

## Keys
A list key must be stable and unique. An index key reuses the wrong component
state when the list reorders.

## Memo
\`memo\` and \`useMemo\` are for measured cost, not for style. The common real win
is a stable callback identity passed to a memoised child.

## StrictMode
It double-invokes effects in development on purpose: an effect that is not
idempotent is a bug, and StrictMode is how you find it before a user does.`,
  },
  shell: {
    title: 'The shell — quoting, pipes, and the failures that look like nothing',
    summary: 'quoting, exit codes, set -e, pipes, find/xargs, windows quirks',
    body: `# Shell

## Quoting
\`"$var"\` almost always. Unquoted, a value with a space becomes two arguments.
Single quotes are literal; double quotes expand. \`"$@"\` preserves each argument
as its own; \`"$*"\` does not.

## Exit codes
0 is success. Check \`$?\` after a command when the next step depends on it.
\`set -euo pipefail\` at the top of a script: stop on error, stop on an unset
variable, and let a failure inside a pipe fail the pipeline.

## Pipes
\`cmd | tee log\` writes and shows. \`2>&1\` merges stderr into stdout — order
matters, put it after the redirect it should join.

## Finding things
\`find . -name '*.ts' -print0 | xargs -0 cmd\` — null-separated, so a filename
with a space survives. \`grep -r\` on a big tree is slower than ripgrep.

## Windows quirks
Paths use backslashes in cmd, forward slashes in Git Bash. \`NUL\` is the null
device in cmd, \`/dev/null\` in bash. Line endings: a CRLF script fails with
"bad interpreter".`,
  },
}

function libraryDir(): string {
  return join(DATA_DIR, 'library')
}

function ensureSeed(): void {
  const dir = libraryDir()
  try {
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    for (const [id, topic] of Object.entries(SEED)) {
      const file = join(dir, `${id}.md`)
      /* never overwrite a topic the reader edited */
      if (!existsSync(file)) {
        writeFileSync(file, `---\ntitle: ${topic.title}\nsummary: ${topic.summary}\n---\n\n${topic.body}\n`, 'utf8')
      }
    }
  } catch {
    /* a read-only data dir still leaves the tools answering "not found" */
  }
}

function parse(raw: string, id: string): Topic {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(raw)
  if (!m) return { id, title: id, summary: '', body: raw.trim() }
  const meta: Record<string, string> = {}
  for (const line of m[1].split(/\r?\n/)) {
    const i = line.indexOf(':')
    if (i === -1) continue
    meta[line.slice(0, i).trim().toLowerCase()] = line.slice(i + 1).trim()
  }
  return {
    id,
    title: meta.title || id,
    summary: meta.summary || '',
    body: m[2].trim(),
  }
}

/** every topic — level 1 is the title + summary */
export function listTopics(): Topic[] {
  ensureSeed()
  const dir = libraryDir()
  if (!existsSync(dir)) return []
  let files: string[] = []
  try {
    files = readdirSync(dir).filter((f) => f.toLowerCase().endsWith('.md'))
  } catch {
    return []
  }
  const out: Topic[] = []
  for (const file of files) {
    try {
      out.push(parse(readFileSync(join(dir, file), 'utf8'), file.replace(/\.md$/i, '')))
    } catch {
      /* skip an unreadable topic */
    }
  }
  return out.sort((a, b) => a.id.localeCompare(b.id))
}

/** the line the prompt carries: what the library covers */
export function libraryIndexBlock(): string {
  const topics = listTopics()
  if (topics.length === 0) return ''
  /* three words each: the index is a shelf label, the body is the book */
  const lines = topics.map((t) => `- ${t.id}: ${(t.summary || t.title).split(/[,;]/).slice(0, 3).join(',')}`)
  return `\n\nLIBRARY — depth on demand. Call read_library with one of these ids when the task needs the details; do not guess at them.\n${lines.join('\n')}`
}

/** level 3 — the body, when the model asks */
export function readTopic(id: string): Topic | null {
  const topics = listTopics()
  const exact = topics.find((t) => t.id.toLowerCase() === id.toLowerCase().trim())
  if (exact) return exact
  const fuzzy = topics.find(
    (t) =>
      t.id.toLowerCase().includes(id.toLowerCase().trim()) ||
      t.title.toLowerCase().includes(id.toLowerCase().trim()),
  )
  return fuzzy ?? null
}

/** keyword search across titles, summaries and bodies */
export function searchTopics(query: string, limit = 4): { topic: Topic; snippet: string }[] {
  const words = query
    .toLowerCase()
    .split(/[^\p{L}\p{N}_-]+/u)
    .filter((w) => w.length > 2)
  const topics = listTopics()
  if (words.length === 0) return topics.slice(0, limit).map((t) => ({ topic: t, snippet: t.summary }))
  const scored = topics
    .map((topic) => {
      const hay = `${topic.id} ${topic.title} ${topic.summary} ${topic.body}`.toLowerCase()
      let score = 0
      for (const w of words) if (hay.includes(w)) score += 1
      let snippet = ''
      for (const line of topic.body.split('\n')) {
        if (words.some((w) => line.toLowerCase().includes(w))) {
          snippet = line.trim().slice(0, 200)
          break
        }
      }
      return { topic, snippet: snippet || topic.summary, score }
    })
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score)
  return scored.slice(0, limit).map(({ topic, snippet }) => ({ topic, snippet }))
}
