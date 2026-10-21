import { readFileSync, statSync } from 'node:fs'
import { resolveInside } from './config.ts'

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
