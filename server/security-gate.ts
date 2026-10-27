import { readFileSync, statSync } from 'node:fs'
import { resolveInside } from './config.ts'
import { kbForRule } from './security-kb.ts'

/* ---------------------------------------------------------------------------
   The security gate.

   After a run changes files, this scans them deterministically — regex rules,
   not model judgement — so it protects the user even when the model is weak.
   It is deliberately conservative and small: secrets, private keys, eval,
   innerHTML, child_process, insecure http. A finding is reported with file:line
   and a snippet, and critical findings mean "do not ship".

   It never throws: a gate that cannot run must not fail the user's task.
   --------------------------------------------------------------------------- */

export type Severity = 'critical' | 'high' | 'medium' | 'low'

export interface Finding {
  severity: Severity
  rule: string
  file: string
  line: number
  snippet: string
}

const RULES: { id: string; sev: Severity; re: RegExp }[] = [
  { id: 'private-key', sev: 'critical', re: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/ },
  { id: 'aws-key', sev: 'critical', re: /\bAKIA[0-9A-Z]{16}\b/ },
  { id: 'generic-secret', sev: 'high', re: /(?:api[_-]?key|secret|password|token)\s*[:=]\s*['"][A-Za-z0-9_\-]{16,}['"]/i },
  { id: 'eval', sev: 'high', re: /\beval\s*\(/ },
  { id: 'innerhtml', sev: 'high', re: /\.innerHTML\s*=|dangerouslySetInnerHTML/ },
  { id: 'child-process', sev: 'medium', re: /child_process|execSync\(/ },
  { id: 'insecure-http', sev: 'low', re: /http:\/\/(?!localhost|127\.0\.0\.1)/ },
  /* --- the second pass: the classes a secrets grep misses ------------------ */
  {
    id: 'sqli',
    sev: 'critical',
    re: /(?:`|\+)[^`\n]*\b(?:SELECT|INSERT\s+INTO|UPDATE\s+\w+\s+SET|DELETE\s+FROM)\b[^`\n]*(?:\$\{|['"]\s*\+)/i,
  },
  {
    id: 'sql-concat',
    sev: 'critical',
    re: /(?:query|execute|exec|raw)\s*\(\s*[`'"][^`'"]*(?:select|insert|update|delete)\b[^`'"]*\$\{/i,
  },
  {
    id: 'command-injection',
    sev: 'critical',
    re: /\b(?:exec|execSync|spawnSync)\s*\(\s*`[^`]*\$\{/,
  },
  {
    id: 'path-traversal',
    sev: 'high',
    re: /\b(?:readFile|readFileSync|writeFile|writeFileSync|createReadStream|sendFile|unlink|rm)\s*\(\s*(?:join|resolve)?\s*\([^)]*\b(?:req|request|params|query|body)\./,
  },
  {
    id: 'weak-crypto',
    sev: 'high',
    re: /\b(?:createHash\s*\(\s*['"](?:md5|sha1)['"]|md5\s*\(|sha1\s*\()/i,
  },
  {
    id: 'weak-random',
    sev: 'high',
    re: /\b(?:token|nonce|otp|secret|session|reset|apiKey|password)\w*\s*=\s*[^;\n]{0,80}Math\.random\s*\(/i,
  },
  {
    id: 'jwt-none',
    sev: 'critical',
    re: /algorithms?\s*:\s*\[[^\]]*['"]none['"]|verify\s*:\s*false/i,
  },
  {
    id: 'cors-wildcard',
    sev: 'high',
    re: /Access-Control-Allow-Origin['"]?\s*[:=,]\s*['"]\*['"]|origin\s*:\s*['"]\*['"]\s*,\s*credentials\s*:\s*true/i,
  },
  {
    id: 'open-redirect',
    sev: 'medium',
    re: /(?:res\.redirect|Response\.redirect|location\.(?:href|assign|replace)\s*=)\s*[\(\s]*(?:req\.|request\.|url\.|searchParams|params\.)/,
  },
  {
    id: 'unsafe-yaml',
    sev: 'high',
    re: /yaml\.load\s*\([^)]*\)\s*(?!.*(?:SafeLoader|safe_load))/,
  },
  {
    id: 'log-secret',
    sev: 'medium',
    re: /console\.(?:log|info|debug)\s*\([^)]*\b(?:password|token|secret|apiKey|authorization)\b/i,
  },
  {
    id: 'ssrf-fetch',
    sev: 'high',
    re: /\bfetch\s*\(\s*(?:req\.|request\.|body\.|params\.|query\.|String\(\s*req\.)/,
  },
  {
    id: 'cookie-insecure',
    sev: 'medium',
    re: /httpOnly\s*:\s*false|secure\s*:\s*false/i,
  },
]

const MAX_FILES = 40
const MAX_BYTES = 200_000
const MAX_FINDINGS = 30

/** the pure rule pass — no filesystem, so it is easy to test and reuse */
export function scanText(content: string, file = '<text>'): Finding[] {
  const out: Finding[] = []
  const lines = content.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    for (const r of RULES) {
      if (r.re.test(line)) {
        out.push({
          severity: r.sev,
          rule: r.id,
          file,
          line: i + 1,
          snippet: line.trim().slice(0, 120),
        })
        if (out.length >= MAX_FINDINGS) return out
      }
    }
  }
  return out
}

/** scan the given paths (workspace-relative or absolute) for findings */
export function scanPaths(paths: string[]): Finding[] {
  const out: Finding[] = []
  for (const p of paths.slice(0, MAX_FILES)) {
    let abs: string
    try {
      abs = resolveInside(p)
    } catch {
      continue
    }
    let content: string
    try {
      const st = statSync(abs)
      if (!st.isFile() || st.size > MAX_BYTES) continue
      content = readFileSync(abs, 'utf8')
    } catch {
      continue
    }
    /* skip binaries */
    if (content.includes('\u0000')) continue
    out.push(...scanText(content, p))
    if (out.length >= MAX_FINDINGS) break
  }
  return out.slice(0, MAX_FINDINGS)
}

export function hasCritical(findings: Finding[]): boolean {
  return findings.some((f) => f.severity === 'critical')
}

/* Source languages only: a scan that reads .md files reports its own examples
   as findings, and one that reads lockfiles reports "generic-secret" on every
   hash. The graph already knows what each file is. */
const SOURCE_LANGS = new Set([
  'ts', 'tsx', 'js', 'jsx', 'python', 'go', 'rust', 'java', 'kotlin', 'csharp', 'ruby', 'php', 'swift', 'c', 'cpp',
])

/** scan the whole open folder, newest files first, bounded */
export async function scanWorkspace(opts: { maxFiles?: number } = {}): Promise<Finding[]> {
  const { indexWorkspace } = await import('./graph.ts')
  const graph = await indexWorkspace()
  const targets = graph.files
    .filter((f) => SOURCE_LANGS.has(f.lang))
    .sort((a, b) => b.mtime - a.mtime)
    .slice(0, opts.maxFiles ?? 400)
  return scanPaths(targets.map((f) => f.path))
}

/** findings as a model-ready list, each pointing at its CWE page */
export function formatFindings(findings: Finding[], limit = 30): string {
  if (findings.length === 0) return 'No findings.'
  const counts = findings.reduce<Record<string, number>>((acc, f) => {
    acc[f.severity] = (acc[f.severity] ?? 0) + 1
    return acc
  }, {})
  const head = `${findings.length} finding(s): ${Object.entries(counts)
    .map(([k, v]) => `${v} ${k}`)
    .join(', ')}`
  const rows = findings.slice(0, limit).map((f) => {
    const entry = kbForRule(f.rule)
    return `  ${f.severity.toUpperCase()} · ${f.rule}${entry ? ` (${entry.id} ${entry.title})` : ''} — ${f.file}:${f.line}\n     ${f.snippet}`
  })
  return [head, ...rows].join('\n')
}
