import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { DATA_DIR, getWorkspace } from './config.ts'

/* ---------------------------------------------------------------------------
   Skills — ready-made expertise, injected only when it is relevant.

   A skill is a small markdown file with frontmatter: a name, a description and
   trigger words. When the user's message matches a skill, its body is appended
   to the system prompt so the model starts from a real checklist instead of
   improvising. This is how a weak model stops "thinking dumb" about a domain it
   was never good at (game loops, design clichés, security).

   Skills live in the workspace's `.loong/skills` and in the global
   `DATA_DIR/skills`. A starter pack is seeded on first read so the app ships
   useful from day one.
   --------------------------------------------------------------------------- */

export interface Skill {
  name: string
  description: string
  triggers: string[]
  body: string
  source: string
}

const STARTERS: Record<string, string> = {
  'game-dev.md': `---
name: game-dev
description: Game engines and game programming — Godot, Unity, Unreal, web games.
triggers: game, godot, unity, unreal, sprite, physics, collision, game loop, fps, platformer, shader, asset, level
---
When building a game:
- Start from the core loop: input → update → render. Keep it one scene until it plays.
- Physics and collision are fixed-timestep; never tie them to frame rate.
- Asset pipeline: name assets consistently, keep source files out of the build.
- Performance: object pools for bullets/particles; cap draw calls; profile before optimizing.
- Controls must feel right before content is added — juice (screenshake, particles, sfx) last.
- Ship a playable build and test it; a screenshot is not a game.`,
  'game-design.md': `---
name: game-design
description: Game design — mechanics, balance, progression, onboarding.
triggers: game design, mechanic, balance, difficulty, progression, level design, onboarding, reward, loop
---
When designing a game:
- Name the fantasy (what the player imagines) and the verb (what they do most).
- One core mechanic, taught by play, not by text. First 30 seconds must be fun.
- Difficulty curve: introduce → combine → twist → test. No wall without a lesson.
- Balance by numbers you can tune in one place, not by scattered magic constants.
- Reward loop: effort → feedback → growth. Feedback within 100ms of input.`,
  'web-design.md': `---
name: web-design
description: Web design that does not look like a generated template.
triggers: website, landing, web design, ui, ux, layout, hero, typography, css, tailwind, design
---
When designing a web interface:
- Start with hierarchy, not decoration: one primary action per screen, one focal point.
- Type scale (1.25–1.33), 8px spacing grid, generous whitespace, consistent radii.
- Motion is short (120–200ms) and explains a state change; never decorative loops.
- Accessibility: contrast ≥ 4.5:1, focus states, keyboard paths, real labels.
- ANTI-CLICHÉ (hard rules): no neon gradients, no purple/violet "AI" palette, no emoji
  in UI, no glassmorphism by default, no generic centered hero + three cards. Choose a
  restrained, intentional palette and a real content structure instead.
- Show, don't claim: use a real example/table/screenshot, not lorem ipsum.`,
  'design-critic.md': `---
name: design-critic
description: Critique a UI before shipping — rejects template clichés and weak hierarchy.
triggers: review design, critique, polish, redesign, looks generic, cliché, ugly, ui review
---
Before calling a UI done, run this checklist and fix what fails:
1. Is there ONE clear focal point per screen? If everything shouts, nothing does.
2. Does the palette avoid neon/purple-gradient/emoji clichés? Is it intentional?
3. Is spacing on an 8px grid, and is whitespace generous?
4. Is the type scale consistent, with a real hierarchy (not 5 sizes of 14px)?
5. Does every interactive element have hover/focus/active states and a 120–200ms transition?
6. Is contrast ≥ 4.5:1? Are focus rings visible?
7. Does the layout hold at 360px, 768px and 1440px without breaking?
8. Is motion purposeful and non-looping? Anything that spins forever is a bug.
Reject the design and fix the top three failures before reporting success.`,
  'security.md': `---
name: security
description: Security review for generated code — OWASP, secrets, input, least privilege.
triggers: security, vulnerability, auth, injection, xss, csrf, secret, token, sanitize, owasp
---
Security pass before shipping:
- Never hardcode secrets; read from env/keychain. Scan for keys before commit.
- Validate and bound every input at the boundary; never trust the client.
- No eval, no dynamic code from user input, no innerHTML with untrusted data.
- SQL/commands: parameterise, never concatenate.
- Auth: least privilege, short-lived tokens, verify on the server, not the client.
- Dependencies: pin and audit; remove unused packages.
- HTTPS only; never log secrets or full tokens.`,
}

function parseSkill(raw: string, source: string): Skill | null {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(raw)
  if (!m) return null
  const meta: Record<string, string> = {}
  for (const line of m[1].split(/\r?\n/)) {
    const idx = line.indexOf(':')
    if (idx === -1) continue
    meta[line.slice(0, idx).trim().toLowerCase()] = line.slice(idx + 1).trim()
  }
  const name = meta.name || source.replace(/\.md$/i, '')
  const triggers = (meta.triggers ?? '')
    .split(',')
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean)
  return {
    name,
    description: meta.description ?? '',
    triggers,
    body: m[2].trim(),
    source,
  }
}

function skillDirs(): string[] {
  return [join(getWorkspace(), '.loong', 'skills'), join(DATA_DIR, 'skills')]
}

/** write the starter pack into the global dir once, so the app ships useful */
function ensureStarters(): void {
  const global = join(DATA_DIR, 'skills')
  try {
    if (!existsSync(global)) mkdirSync(global, { recursive: true })
    for (const [file, content] of Object.entries(STARTERS)) {
      const path = join(global, file)
      if (!existsSync(path)) writeFileSync(path, content, 'utf8')
    }
  } catch {
    /* a read-only data dir must not break a run */
  }
}

export function listSkills(): Skill[] {
  ensureStarters()
  const out: Skill[] = []
  for (const dir of skillDirs()) {
    if (!existsSync(dir)) continue
    let entries: string[]
    try {
      entries = readdirSync(dir)
    } catch {
      continue
    }
    for (const name of entries) {
      if (!name.toLowerCase().endsWith('.md')) continue
      const path = join(dir, name)
      try {
        if (!statSync(path).isFile()) continue
        const skill = parseSkill(readFileSync(path, 'utf8'), name)
        if (skill) out.push(skill)
      } catch {
        /* skip an unreadable skill */
      }
    }
  }
  return out
}

/** the skills that fit this task, best first */
export function selectSkills(text: string, limit = 3): Skill[] {
  const hay = text.toLowerCase()
  const scored = listSkills()
    .map((s) => {
      let score = 0
      for (const t of s.triggers) {
        if (!t) continue
        /* very short triggers (ui, ux) must be whole words, or "build" would
           match "ui" and pull the design skill into every task */
        if (t.length < 3) {
          const safe = t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
          if (new RegExp(`\\b${safe}\\b`).test(hay)) score += 2
        } else if (hay.includes(t)) {
          score += 2
        }
      }
      if (hay.includes(s.name.toLowerCase())) score += 3
      for (const word of s.description.toLowerCase().split(/[^a-z0-9]+/)) {
        if (word.length > 3 && hay.includes(word)) score += 1
      }
      return { s, score }
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
  return scored.slice(0, limit).map((x) => x.s)
}

/** the block appended to the system prompt for this task (empty when none fit) */
export function skillsBlock(text: string, cap = 3200): string {
  if (!text.trim()) return ''
  const picked = selectSkills(text)
  if (picked.length === 0) return ''
  let out = '\n\n--- skills (follow these when they apply) ---'
  for (const s of picked) out += `\n\n## ${s.name}\n${s.body}`
  return out.length > cap ? `${out.slice(0, cap)}\n…` : out
}
