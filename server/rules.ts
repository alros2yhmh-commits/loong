import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import type { Dirent } from 'node:fs'
import { join } from 'node:path'
import { getWorkspace } from './config.ts'
import { clip } from './config.ts'

/* ---------------------------------------------------------------------------
   Project rules, and skills.

   The CLAUDE.md pattern, widened: a file at the workspace root that the agent
   reads before its first action, carrying project-specific rules, conventions
   and context the model would otherwise have to discover by trial and error.

   Loong looks for LOONG.md. Since 2025 the open standard is AGENTS.md — most
   real repositories carry one — so that is read too, and both are injected
   into the system prompt after the base instructions and before the workspace
   line, so the model sees them as rules, not as conversation.

   The Agent Skills standard (an open format since December 2025) is read as
   well: a folder per skill under the skills directory, each with a SKILL.md
   carrying YAML frontmatter and instructions.
   Everything here is read at the start of each run, not cached, so a change
   takes effect on the next message without a restart — and everything is
   clipped, because a rules file is not a place to put a manual.
   --------------------------------------------------------------------------- */

const MAX_RULES_CHARS = 8_000
const MAX_SKILLS = 12
const MAX_SKILL_CHARS = 1_200

function readIfFile(path: string): string | null {
  try {
    if (!existsSync(path)) return null
    const s = statSync(path)
    if (!s.isFile()) return null
    const text = readFileSync(path, 'utf8').trim()
    return text || null
  } catch {
    return null
  }
}

/** the rules file: LOONG.md first (ours), then AGENTS.md (the open standard) */
export function readProjectRules(): string | null {
  const ws = getWorkspace()
  const parts: string[] = []
  for (const name of ['LOONG.md', 'loong.md']) {
    const text = readIfFile(join(ws, name))
    if (text) {
      parts.push(`# From ${name}\n\n${text}`)
      break
    }
  }
  const agents = readIfFile(join(ws, 'AGENTS.md'))
  if (agents) parts.push(`# From AGENTS.md\n\n${agents}`)
  if (parts.length === 0) return null
  return clip(parts.join('\n\n'), MAX_RULES_CHARS)
}

export interface Skill {
  name: string
  description: string
  body: string
}

/** the frontmatter of a SKILL.md: name and description, as the standard defines */
function parseFrontmatter(raw: string): { name: string; description: string; body: string } {
  const match = /^---\s*\n([\s\S]*?)\n---\s*\n?([\s\S]*)$/.exec(raw)
  if (!match) return { name: '', description: '', body: raw }
  const fields: Record<string, string> = {}
  for (const line of match[1].split('\n')) {
    const kv = /^([A-Za-z-]+)\s*:\s*(.*)$/.exec(line.trim())
    if (kv) fields[kv[1].toLowerCase()] = kv[2].replace(/^["']|["']$/g, '')
  }
  return {
    name: fields.name ?? '',
    description: fields.description ?? '',
    body: match[2].trim(),
  }
}

/** every skill folder under the workspace root — SKILL.md inside each */
export function readSkills(): Skill[] {
  const root = join(getWorkspace(), 'skills')
  let entries: Dirent[] = []
  try {
    if (!existsSync(root)) return []
    entries = readdirSync(root, { withFileTypes: true }) as unknown as Dirent[]
  } catch {
    return []
  }
  const skills: Skill[] = []
  for (const entry of entries) {
    if (skills.length >= MAX_SKILLS) break
    if (!entry.isDirectory()) continue
    const raw = readIfFile(join(root, String(entry.name), 'SKILL.md'))
    if (!raw) continue
    const { name, description, body } = parseFrontmatter(raw)
    skills.push({
      name: name || String(entry.name),
      description: description || '(no description)',
      body: clip(body, MAX_SKILL_CHARS),
    })
  }
  return skills
}

/** the text to inject into the system prompt, or an empty string */
export function projectRulesBlock(): string {
  const rules = readProjectRules()
  const parts: string[] = []
  if (rules) {
    parts.push(
      `\n\nPROJECT RULES (from LOONG.md / AGENTS.md in the workspace root — follow these as project-specific instructions):\n\n${rules}\n`,
    )
  }
  const skills = readSkills()
  if (skills.length > 0) {
    const list = skills
      .map((s) => `- ${s.name}: ${s.description}\n\n${s.body}`)
      .join('\n\n---\n\n')
    parts.push(
      `\n\nSKILLS (the project keeps its own playbooks in skills/*/SKILL.md — follow the ones that apply to this task):\n\n${list}\n`,
    )
  }
  return parts.join('')
}
