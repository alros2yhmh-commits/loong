import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { DATA_DIR } from './config.ts'

/* ---------------------------------------------------------------------------
   The user, as this agent knows them.

   Durable memory stores facts about WORK. This stores facts about the PERSON:
   their name, how they like to be answered, what they build, what they already
   know. It is small and hand-editable, and it is injected into every run, so the
   agent stops opening with "how can I help?" to someone it has worked with for
   months.

   The rule is the same as the rest of the agent's stores: only the agent writes
   it, through a tool, and the file lives outside the workspace where no run can
   reach it.
   --------------------------------------------------------------------------- */

export interface ProfileFact {
  id: string
  text: string
  at: number
}

interface ProfileStore {
  version: 1
  name: string
  facts: ProfileFact[]
  updatedAt: number
}

const FILE = join(DATA_DIR, 'profile.json')
const MAX_FACTS = 80
const MAX_FACT_CHARS = 400
const MAX_NAME = 60
const EMPTY: ProfileStore = { version: 1, name: '', facts: [], updatedAt: 0 }

function load(): ProfileStore {
  if (!existsSync(FILE)) return { ...EMPTY, facts: [] }
  try {
    const parsed = JSON.parse(readFileSync(FILE, 'utf8')) as Partial<ProfileStore>
    if (parsed.version !== 1 || !Array.isArray(parsed.facts)) throw new Error('shape')
    return {
      version: 1,
      name: typeof parsed.name === 'string' ? parsed.name.slice(0, MAX_NAME) : '',
      facts: parsed.facts.filter((f): f is ProfileFact => {
        const o = f as unknown as Record<string, unknown>
        return typeof o?.id === 'string' && typeof o?.text === 'string' && typeof o?.at === 'number'
      }),
      updatedAt: typeof parsed.updatedAt === 'number' ? parsed.updatedAt : 0,
    }
  } catch {
    try {
      renameSync(FILE, `${FILE}.corrupt-${Date.now()}`)
    } catch {
      /* unreadable either way */
    }
    return { ...EMPTY, facts: [] }
  }
}

function flush(store: ProfileStore): void {
  try {
    mkdirSync(DATA_DIR, { recursive: true })
    const tmp = `${FILE}.${process.pid}.tmp`
    writeFileSync(tmp, JSON.stringify(store, null, 2), 'utf8')
    renameSync(tmp, FILE)
  } catch {
    /* a read-only data dir is not a reason to fail a run */
  }
}

function clean(text: string, max: number): string {
  const t = String(text ?? '').trim().replace(/\s+/g, ' ')
  return t.length > max ? `${t.slice(0, max - 1)}…` : t
}

export function setProfileName(name: string): string {
  const store = load()
  store.name = clean(name, MAX_NAME)
  store.updatedAt = Date.now()
  flush(store)
  return store.name
}

/** a fact about the person. Identical text is refreshed, never duplicated. */
export function learnAbout(text: string): ProfileFact {
  const value = clean(text, MAX_FACT_CHARS)
  if (!value) throw new Error('Nothing to save — the fact was empty.')
  const store = load()
  const same = store.facts.find((f) => f.text.toLowerCase() === value.toLowerCase())
  if (same) {
    same.at = Date.now()
    store.updatedAt = same.at
    flush(store)
    return same
  }
  const fact: ProfileFact = { id: randomUUID(), text: value, at: Date.now() }
  store.facts.push(fact)
  if (store.facts.length > MAX_FACTS) store.facts = store.facts.slice(store.facts.length - MAX_FACTS)
  store.updatedAt = fact.at
  flush(store)
  return fact
}

export function forgetProfileFact(id: string): boolean {
  const store = load()
  const next = store.facts.filter((f) => f.id !== id)
  if (next.length === store.facts.length) return false
  store.facts = next
  store.updatedAt = Date.now()
  flush(store)
  return true
}

export function readProfile(): ProfileStore {
  return load()
}

/** what the prompt carries: a name and the newest few things worth knowing */
export function profileBlock(limit = 14): string {
  const store = load()
  if (!store.name && store.facts.length === 0) return ''
  const facts = [...store.facts].sort((a, b) => b.at - a.at).slice(0, limit)
  const lines = facts.map((f) => `- ${clean(f.text, 220)}`)
  const nameLine = store.name ? `\nThe person's name is ${store.name}.` : ''
  return `

USER PROFILE — durable facts about the person you work with.${nameLine}
${lines.join('\n')}
Update it with remember_user when they tell you something durable; never invent a fact about them.`
}

/** only for tests */
export function resetProfileForTests(): void {
  flush({ version: 1, name: '', facts: [], updatedAt: 0 })
}
