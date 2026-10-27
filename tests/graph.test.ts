import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setWorkspace } from '../server/config.ts'
import {
  cyclesOf,
  impactReport,
  indexWorkspace,
  mapReport,
  neighboursReport,
  normalizeTarget,
  statsOf,
} from '../server/graph.ts'

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'loong-graph-'))
  setWorkspace(root)
  mkdirSync(join(root, 'src'), { recursive: true })
  writeFileSync(
    join(root, 'src', 'a.ts'),
    "import { beta } from './b'\nexport function alpha() { return beta() }\n",
  )
  writeFileSync(
    join(root, 'src', 'b.ts'),
    "import { alpha } from './a'\nexport function beta() { return 1 }\n",
  )
  writeFileSync(
    join(root, 'src', 'index.ts'),
    "import { alpha } from './a'\nimport 'react'\nexport const start = () => alpha()\n",
  )
  writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'fx', main: 'src/index.ts' }))
  return root
}

test('the graph resolves relative imports and keeps packages separate', async () => {
  fixture()
  const g = await indexWorkspace({ force: true })
  const a = g.files.find((f) => f.path === 'src/a.ts')
  assert.ok(a, 'src/a.ts is a node')
  assert.deepEqual(a.imports, ['src/b.ts'])
  assert.equal(a.external.length, 0)
  assert.ok(a.symbols.includes('alpha'))

  const index = g.files.find((f) => f.path === 'src/index.ts')
  assert.ok(index)
  assert.deepEqual(index.imports, ['src/a.ts'])
  assert.deepEqual(index.external, ['react'])
  assert.equal(index.entry, true)

  const stats = statsOf(g)
  assert.equal(stats.sourceFiles, 3)
  assert.equal(stats.edges, 3)
  assert.ok(stats.entries.includes('src/index.ts'))
})

test('an import cycle is found once, and the map names it', async () => {
  fixture()
  const g = await indexWorkspace({ force: true })
  const cycles = cyclesOf(g)
  assert.equal(cycles.length, 1)
  assert.equal(cycles[0][0], cycles[0][cycles[0].length - 1])
  assert.deepEqual(new Set(cycles[0]), new Set(['src/a.ts', 'src/b.ts']))

  const map = mapReport(g)
  assert.match(map, /Import cycles \(1\)/)
  assert.match(map, /src\/a\.ts/)
})

test('neighbours answers who imports a file without a grep', async () => {
  fixture()
  const g = await indexWorkspace({ force: true })
  const report = neighboursReport(g, 'src/a.ts')
  assert.match(report, /Imported by \(2\): src\/b\.ts, src\/index\.ts/)
  assert.match(report, /Imports \(1\): src\/b\.ts/)

  const impact = impactReport(g, 'src/b.ts')
  assert.match(impact, /Impact of src\/b\.ts: 2 file\(s\)/)
  assert.match(impact, /depth 1: src\/a\.ts/)
  assert.match(impact, /No test in the graph/)
})

test('a re-index picks up a file added later', async () => {
  const root = fixture()
  await indexWorkspace({ force: true })
  writeFileSync(join(root, 'src', 'c.ts'), 'export function gamma() { return 3 }\n')
  const g = await indexWorkspace({ force: true })
  assert.equal(statsOf(g).sourceFiles, 4)
  assert.ok(g.files.some((f) => f.path === 'src/c.ts' && f.symbols.includes('gamma')))
})

test('a target normalises to the workspace-relative form', () => {
  const root = fixture()
  assert.equal(normalizeTarget(join(root, 'src', 'a.ts')), 'src/a.ts')
  assert.equal(normalizeTarget('src\\a.ts'), 'src/a.ts')
})

test('package imports in Java/Kotlin resolve to the class file', async () => {
  const root = mkdtempSync(join(tmpdir(), 'loong-graph-jvm-'))
  setWorkspace(root)
  const pkg = join(root, 'app', 'src', 'main', 'java', 'com', 'x')
  mkdirSync(pkg, { recursive: true })
  writeFileSync(
    join(pkg, 'Repo.kt'),
    'package com.x\nimport com.x.Model\nclass Repo(val m: Model)\n',
  )
  writeFileSync(
    join(pkg, 'Model.kt'),
    'package com.x\nimport com.x.Repo\nclass Model(val r: Repo?)\n',
  )
  const g = await indexWorkspace({ force: true })
  const repo = g.files.find((f) => f.path.endsWith('Repo.kt'))
  assert.ok(repo)
  assert.equal(repo.imports.length, 1)
  assert.ok(repo.imports[0].endsWith('Model.kt'))
  assert.equal(cyclesOf(g).length, 1)
})
