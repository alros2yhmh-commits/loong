/* The 1.0.0 loop: one call for many files, and a request compiled before it runs. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

test('read_many reads twenty files in one call, inside one budget', async () => {
  const ws = mkdtempSync(join(tmpdir(), 'loong-batch-'))
  const { setWorkspace } = await import('../server/config.ts')
  setWorkspace(ws)
  for (let i = 0; i < 20; i++) {
    writeFileSync(join(ws, `file-${i}.ts`), `export function fn${i}() {\n  return ${i}\n}\n`)
  }
  const { readManyTool } = await import('../server/tools-batch.ts')
  const out = String(
    await readManyTool.execute!(
      { paths: Array.from({ length: 20 }, (_, i) => `file-${i}.ts`) },
      { toolCallId: 't', messages: [] } as never,
    ),
  )
  assert.match(out, /Read 20 files/)
  assert.match(out, /fn19/)
  /* the numbering is there, so the model can cite a line */
  assert.match(out, /\n1 {2}export function fn0/)
})

test('outline is the shape without the body', async () => {
  const { outlineOf } = await import('../server/tools-batch.ts')
  const source = [
    'import { x } from "y"',
    'export function alpha() {',
    '  const body = 1',
    '  return body',
    '}',
    'export class Beta {',
    '  run() {}',
    '}',
  ].join('\n')
  const outline = outlineOf(source, 'a.ts')
  assert.match(outline, /alpha/)
  assert.match(outline, /Beta/)
  assert.doesNotMatch(outline, /const body = 1/, 'the body is not in the outline')
})

test('a plain request compiles to a brief with a shape', async () => {
  const { compileBrief, briefBlock } = await import('../server/brief.ts')
  /* a question stays a question — no plan, no ceremony */
  const small = compileBrief('what is a closure?')
  assert.equal(small.complexity, 'trivial')
  assert.equal(small.intent, 'explain')
  assert.match(briefBlock(small), /answer it directly and stop/)

  /* a big ask gets steps and a plan */
  const big = compileBrief(
    'refactor the whole settings page to use the new design system, everywhere in the app, and make sure nothing breaks',
  )
  assert.equal(big.complexity, 'large')
  assert.equal(big.intent, 'refactor')
  assert.ok(big.steps.length >= 3)
  assert.equal(big.wantsPlan, true)

  /* a fix gets the fix shape */
  const fix = compileBrief('the build crashes when I open settings, fix it')
  assert.equal(fix.intent, 'fix')
  assert.match(fix.steps.join(' '), /Reproduce/)

  /* research is named as research */
  const research = compileBrief('compare zustand and redux for 2026')
  assert.equal(research.wantsResearch, true)
})
