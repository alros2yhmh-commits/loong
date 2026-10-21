import { existsSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

/* ---------------------------------------------------------------------------
   The edit engine.

   A single raw.replace() is how a coding agent eats a file: it replaces the
   FIRST occurrence, says nothing when the text appears three times, and
   answers "not found" with no help at all. The model — a weak one especially
   — then retries the same edit forever.

   So matching is a decision, not a hope:
     - exactly one match          → apply it
     - more than one              → refuse, and name every line that matched
     - none                       → refuse, and point at the closest line, so
                                     the model corrects itself once instead of
                                     looping
     - none but a whitespace-only
       difference (CRLF vs LF,
       trailing spaces)           → apply with a note

   Pure, so the tests pin the behaviour without a model in the loop.
   --------------------------------------------------------------------------- */

export type MatchResult =
  | { kind: 'one'; start: number; end: number; note?: string }
  | { kind: 'many'; lines: number[] }
  | { kind: 'none'; hint: string }

/** 1-based line number of a character offset */
function lineOf(raw: string, index: number): number {
  let line = 1
  for (let i = 0; i < index && i < raw.length; i++) {
    if (raw[i] === '\n') line++
  }
  return line
}

/** every start offset of `needle` in `hay`, non-overlapping, in order */
function occurrences(hay: string, needle: string): number[] {
  const out: number[] = []
  if (!needle) return out
  let from = 0
  for (;;) {
    const i = hay.indexOf(needle, from)
    if (i < 0) break
    out.push(i)
    from = i + 1
  }
  return out
}

/** a cheap "these two lines are about the same thing" score for the hint */
function similarity(a: string, b: string): number {
  const ta = a.trim()
  const tb = b.trim()
  if (!ta || !tb) return 0
  if (ta === tb) return 1
  const wordsA = new Set(ta.split(/\s+/))
  const wordsB = tb.split(/\s+/)
  let hit = 0
  for (const w of wordsB) if (wordsA.has(w)) hit++
  return hit / Math.max(wordsA.size, wordsB.length)
}

/** the closest line in the file to the first line of the missing text */
function closestLine(
  rawLines: string[],
  first: string,
): { line: number; text: string } | null {
  let best: { line: number; text: string; score: number } | null = null
  for (let i = 0; i < rawLines.length; i++) {
    const score = similarity(first, rawLines[i])
    if (best === null || score > best.score) {
      best = { line: i + 1, text: rawLines[i], score }
    }
  }
  if (best === null || best.score < 0.3) return null
  return { line: best.line, text: best.text }
}

/**
 * Match `oldText` against `raw`.
 *
 * The line-window fallback is what saves the Windows case: a file saved with
 * CRLF, or with trailing spaces, never matches a clean LF `oldText` — and the
 * naive refusal is what started the E2E loop of identical failed edits.
 */
export function findMatch(raw: string, oldText: string): MatchResult {
  if (!oldText) return { kind: 'none', hint: 'the old text was empty' }

  /* 1. exact — the normal path, byte for byte */
  const exact = occurrences(raw, oldText)
  if (exact.length === 1) {
    return { kind: 'one', start: exact[0], end: exact[0] + oldText.length }
  }
  if (exact.length > 1) {
    return { kind: 'many', lines: exact.map((i) => lineOf(raw, i)) }
  }

  /* 2. whitespace-tolerant: compare line by line, ignoring the line ending
        and any trailing spaces, then apply on the raw line range so the rest
        of the file keeps its own endings */
  const rawLines = raw.split('\n')
  const oldLines = oldText.split('\n')
  const want = oldLines.map((l) => l.replace(/\r$/, '').trimEnd())
  const windows: number[] = []
  for (let i = 0; i + oldLines.length <= rawLines.length; i++) {
    let ok = true
    for (let j = 0; j < oldLines.length; j++) {
      if (rawLines[i + j].replace(/\r$/, '').trimEnd() !== want[j]) {
        ok = false
        break
      }
    }
    if (ok) windows.push(i)
  }
  if (windows.length === 1) {
    const start = rawLines.slice(0, windows[0]).join('\n').length + (windows[0] > 0 ? 1 : 0)
    const end =
      rawLines.slice(0, windows[0] + oldLines.length).join('\n').length
    return {
      kind: 'one',
      start,
      end,
      note: 'matched ignoring trailing whitespace / line endings',
    }
  }
  if (windows.length > 1) {
    return { kind: 'many', lines: windows.map((i) => i + 1) }
  }

  /* 3. nothing — help the model fix itself instead of watching it loop */
  const near = closestLine(rawLines, oldLines[0])
  const hint = near
    ? `the exact text was not found. The closest line is ${near.line}: ${JSON.stringify(near.text.slice(0, 120))} — read the file again and copy the text exactly.`
    : `the exact text was not found in the file. Read the file again and copy the text exactly.`
  return { kind: 'none', hint }
}

export interface EditOp {
  oldText: string
  newText: string
}

export type ApplyResult =
  | { ok: true; content: string; applied: number; notes: string[] }
  | { ok: false; error: string }

/**
 * Apply every edit, or none: each op is matched first, ranges are checked for
 * overlap, and only then does anything touch the disk. A half-applied batch
 * is the second-worst thing an edit tool can do.
 */
export function applyEdits(raw: string, edits: EditOp[]): ApplyResult {
  if (edits.length === 0) return { ok: false, error: 'no edits were given' }

  const matched = edits.map((e, i) => ({ edit: e, index: i, match: findMatch(raw, e.oldText) }))

  for (const m of matched) {
    if (m.match.kind === 'none') {
      return { ok: false, error: `edit ${m.index + 1}: ${m.match.hint}` }
    }
    if (m.match.kind === 'many') {
      const lines = m.match.lines.join(', ')
      return {
        ok: false,
        error: `edit ${m.index + 1}: that text appears ${m.match.lines.length} times (lines ${lines}). Include more surrounding context so it matches exactly once.`,
      }
    }
  }

  /* overlap: two ops writing the same bytes would corrupt each other */
  const ranges = matched
    .map((m) => ({
      index: m.index,
      start: (m.match as { start: number }).start,
      end: (m.match as { end: number }).end,
    }))
    .sort((a, b) => a.start - b.start)
  for (let i = 1; i < ranges.length; i++) {
    if (ranges[i].start < ranges[i - 1].end) {
      return {
        ok: false,
        error: `edit ${ranges[i - 1].index + 1} and edit ${ranges[i].index + 1} overlap — the same text cannot be replaced twice in one batch.`,
      }
    }
  }

  /* apply back-to-front so earlier ranges stay valid */
  let content = raw
  const notes: string[] = []
  for (const m of [...matched].reverse()) {
    const one = m.match as { start: number; end: number; note?: string }
    content = content.slice(0, one.start) + m.edit.newText + content.slice(one.end)
    if (one.note) notes.push(`edit ${m.index + 1}: ${one.note}`)
  }
  return { ok: true, content, applied: matched.length, notes }
}

/* ---------------------------------------------------------------------------
   What "verify" means in this project.

   The harness principle: a check that passes says NOTHING (a silent ✓ never
   enters the model's context), and a check that fails says EVERYTHING (the
   first error lines go straight back). Auto-detection stays to the shapes
   that are unambiguous — a wrong guess here would run the wrong command.
   --------------------------------------------------------------------------- */

export interface VerifyCommand {
  label: string
  cmd: string
}

const MAX_PKG_JSON = 64 * 1024

export function detectVerify(dir: string): VerifyCommand | null {
  try {
    /* node: package.json with a test or build script */
    const pkgPath = join(dir, 'package.json')
    if (existsSync(pkgPath) && statSync(pkgPath).isFile()) {
      const size = statSync(pkgPath).size
      if (size <= MAX_PKG_JSON) {
        const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as {
          scripts?: Record<string, string>
        }
        const scripts = pkg.scripts ?? {}
        /* test first: it is the sharper check, and `test` may be the absent
           one — then build, which almost always exists */
        if (typeof scripts.test === 'string' && scripts.test.trim()) {
          return { label: 'npm test', cmd: 'npm test --silent' }
        }
        if (typeof scripts.build === 'string' && scripts.build.trim()) {
          return { label: 'npm run build', cmd: 'npm run build' }
        }
      }
    }
    /* android: gradlew is the project's own check */
    if (existsSync(join(dir, 'gradlew')) || existsSync(join(dir, 'gradlew.bat'))) {
      if (existsSync(join(dir, 'app'))) {
        return { label: 'gradlew assembleDebug', cmd: 'gradlew assembleDebug' }
      }
    }
    /* make: test is the conventional target */
    if (existsSync(join(dir, 'Makefile')) || existsSync(join(dir, 'makefile'))) {
      return { label: 'make test', cmd: 'make test' }
    }
  } catch {
    /* a broken package.json is not a reason to fail the run */
  }
  return null
}
