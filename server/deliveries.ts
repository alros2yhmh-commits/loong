import { createHash } from 'node:crypto'

/* ---------------------------------------------------------------------------
   Deliveries.

   The failure this exists for: a run submitted six of nine answers, wrote the
   last three into a batch file it never executed, and closed with
   "Section 1 complete — 9/9 submitted". Every gate in the app looked at the
   files and the plan; none of them looked at what had actually left the
   machine, so nothing contradicted the sentence.

   So the harness keeps receipts. A command that talks to the network is an
   outward action, and the key it carried is recorded — once per key, because a
   retried upload is one delivery, not two. A claim of N is then checked against
   receipts, not against the model's confidence.

   The key is a heuristic on purpose: it only has to be stable enough to
   deduplicate and to tell the next run what is already done.
   --------------------------------------------------------------------------- */

export interface Delivery {
  /** what was delivered, as the command named it — `letter-count-1`, or a hash */
  key: string
  /** the command, trimmed, so a human can see what actually ran */
  detail: string
  at: number
}

/** A command that leaves something behind.
 *
 *  A GET is a read. Counting reads as deliveries inflated the receipt book by
 *  six in a real run — every challenge fetch was scored as a submission — and a
 *  receipt that cannot be trusted is worse than none. So: a write method, a
 *  body, a push, or a publish. Nothing else. */
const NETWORK =
  /-X\s*(?:POST|PUT|PATCH)|--data\b|\s-d\s+(?:@|'|")|-Method\s*(?:Post|Put|Patch)|\brequests\.(?:post|put|patch)\b|\bgit\s+push\b|\bnpm\s+publish\b/i

/** the words a completion claim uses when it means "it went out" */
const OUTWARD_VERB =
  /\b(submitt?ed|sent|uploaded|posted|delivered|pushed|answered|filed)\b|تسليم|سلّم|سلم|أرسل|ارسل|رفعت|بعت/i

export function isOutward(command: string): boolean {
  return NETWORK.test(command)
}

function hash(text: string): string {
  return createHash('sha1').update(text).digest('hex').slice(0, 8)
}

/** what a bearer token looks like — never a delivery key */
const SECRET = /^(?:abk_|sk-|sk_|ghp_|gho_|xoxb-|eyJ)/i
const LONG_HEX = /[0-9a-f]{16,}/i

/** The key a command carried.
 *
 *  The JSON body first: a submit call names the thing it is submitting, and
 *  that is the only field worth remembering. Only then a token in the command
 *  line — and never the token from an Authorization header, which is exactly
 *  what a naive "longest identifier with a digit" rule picked in a real run. */
export function deliveryKey(command: string): string {
  const body = /"([A-Za-z0-9_]*(?:key|id|slug|name))"\s*:\s*"([^"]+)"/i.exec(command)
  if (body?.[2]) return body[2].toLowerCase()
  const tokens = command.match(/[A-Za-z][A-Za-z0-9]*(?:[-_][A-Za-z0-9]+)+/g) ?? []
  const meaningful = tokens.filter(
    (t) => !/^(?:--|x-|content-|user-|accept)/i.test(t) && !SECRET.test(t) && !LONG_HEX.test(t),
  )
  const withDigit = meaningful.filter((t) => /\d/.test(t))
  const pool = withDigit.length > 0 ? withDigit : meaningful
  const pick = pool.sort((a, b) => b.length - a.length)[0]
  if (pick) return pick.toLowerCase()
  const url = /https?:\/\/[^\s'"]+/.exec(command)?.[0]
  if (url) {
    const segment = url.split(/[/?#]/).filter(Boolean).pop()
    if (segment) return segment.toLowerCase()
  }
  return `action-${hash(command)}`
}

/** what the run says it delivered: "9/9" → 9, "all 19" → 19, a sentence with no
 *  outward verb → null. A count with no verb is not a claim about delivery, and
 *  "all 12 tests passed" must never be read as twelve uploads. */
export function claimedDeliveries(text: string): number | null {
  let best: number | null = null
  for (const sentence of text.split(/[.!?\n]+/)) {
    if (!OUTWARD_VERB.test(sentence)) continue
    const ratio = /(\d+)\s*\/\s*(\d+)/.exec(sentence)
    const all = /\ball\s+(\d+)\b/i.exec(sentence)
    const n = ratio ? Number(ratio[2]) : all ? Number(all[1]) : null
    if (n !== null && Number.isFinite(n) && n > 0) best = Math.max(best ?? 0, n)
  }
  return best
}

/* ---- the per-run receipt book ------------------------------------------- */

const RUNS = new Map<string, Delivery[]>()

/** record the outward commands a run executed. Called with the commands that
 *  actually ran, so a refused command leaves no receipt. */
export function noteCommands(runId: string, commands: string[]): void {
  if (commands.length === 0) return
  const book = RUNS.get(runId) ?? []
  const known = new Set(book.map((d) => d.key))
  for (const command of commands) {
    if (!isOutward(command)) continue
    const key = deliveryKey(command)
    if (known.has(key)) continue
    known.add(key)
    book.push({ key, detail: command.replace(/\s+/g, ' ').trim().slice(0, 160), at: Date.now() })
  }
  if (book.length > 0) RUNS.set(runId, book.slice(-200))
}

export function deliveriesFor(runId: string): Delivery[] {
  return RUNS.get(runId) ?? []
}

export function clearDeliveries(runId: string): void {
  RUNS.delete(runId)
}

/** merge receipts from more than one place (this run, and the thread's ledger) */
export function mergeDeliveries(...books: (Delivery[] | undefined)[]): Delivery[] {
  const out: Delivery[] = []
  const seen = new Set<string>()
  for (const book of books) {
    for (const item of book ?? []) {
      if (!item || typeof item.key !== 'string' || seen.has(item.key)) continue
      seen.add(item.key)
      out.push(item)
    }
  }
  return out
}
