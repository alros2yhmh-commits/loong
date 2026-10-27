import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

/* ---------------------------------------------------------------------------
   Who the agent says it is.

   The name, the maker and the tagline are product facts, so they live in one
   place and reach the model as a short block at the top of its system prompt.
   The founder comes from the shipped package.json rather than a literal: the
   bundle sits beside a copy of that file, and when it is not there (a dev run
   straight from the source tree) the workspace's own package.json answers.
   --------------------------------------------------------------------------- */

interface Packaged {
  version?: string
  author?: string
  description?: string
}

function readPackage(): Packaged {
  const here = typeof __dirname === 'string' ? __dirname : process.cwd()
  const candidates = [
    /* written next to the bundle at build time — survives the installer */
    join(here, 'identity.json'),
    join(here, '..', 'package.json'),
    join(here, 'package.json'),
    join(process.cwd(), 'package.json'),
  ]
  for (const path of candidates) {
    try {
      if (!existsSync(path)) continue
      const parsed = JSON.parse(readFileSync(path, 'utf8')) as Packaged & { name?: string }
      /* dist-agent/package.json is playwright-core's stand-in — not ours */
      if (parsed.name && parsed.name !== 'loong' && !parsed.author) continue
      if (parsed.author || parsed.description) return parsed
    } catch {
      /* a package.json that cannot be read is not worth a failed run */
    }
  }
  return {}
}

const pkg = readPackage()

export const IDENTITY = {
  name: 'Loong',
  founder: process.env.LOONG_FOUNDER ?? pkg.author ?? 'Professor Hamza Mahmoud Ramadan',
  version: process.env.LOONG_VERSION ?? pkg.version ?? '0.0.0',
  tagline: 'desktop coding agent',
  engine: 'Loong’s own agent runtime',
} as const

/** the one paragraph the model reads about itself, before anything else */
export function identityBlock(): string {
  return `You are ${IDENTITY.name} (龙), a ${IDENTITY.tagline} (version ${IDENTITY.version}) built by ${IDENTITY.founder}. Your loop is ${IDENTITY.engine}.`
}
