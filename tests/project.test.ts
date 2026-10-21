import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PNG } from 'pngjs'
import { detectProject } from '../server/project-run.ts'
import { compareScreens } from '../server/image-diff.ts'

const roots: string[] = []

function dir(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'loong-proj-'))
  roots.push(root)
  for (const [name, content] of Object.entries(files)) {
    writeFileSync(join(root, name), content, 'utf8')
  }
  return root
}

after(() => {
  for (const root of roots) {
    try {
      rmSync(root, { recursive: true, force: true })
    } catch {
      /* best effort */
    }
  }
})

test('a node project is started with its own dev script', () => {
  const root = dir({ 'package.json': JSON.stringify({ scripts: { dev: 'vite' } }) })
  const launch = detectProject(root)
  assert.match(launch.label, /run dev/)
  assert.ok(launch.args.includes('dev'))
})

test('the lockfile picks the package manager', () => {
  const root = dir({
    'package.json': JSON.stringify({ scripts: { start: 'next start' } }),
    'pnpm-lock.yaml': '',
  })
  const launch = detectProject(root)
  assert.match(launch.label, /^pnpm/)
})

test('rust and go are recognised by their manifests', () => {
  assert.equal(detectProject(dir({ 'Cargo.toml': '' })).command, 'cargo')
  assert.equal(detectProject(dir({ 'go.mod': 'module x' })).command, 'go')
})

test('an unknown stack is refused with a sentence, not a guess', () => {
  const root = dir({})
  assert.throws(() => detectProject(root), /do not recognise how to start/i)
})

test('a package.json with no start script is refused', () => {
  const root = dir({ 'package.json': JSON.stringify({ scripts: { test: 'vitest' } }) })
  assert.throws(() => detectProject(root), /no dev\/start\/serve\/preview script/i)
})

/* ---- pixel diff ---------------------------------------------------------- */

function writePng(path: string, width: number, height: number, dark: [number, number][] = []) {
  const img = new PNG({ width, height })
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4
      const isDark = dark.some(([dx, dy]) => dx === x && dy === y)
      img.data[i] = isDark ? 0 : 255
      img.data[i + 1] = isDark ? 0 : 255
      img.data[i + 2] = isDark ? 0 : 255
      img.data[i + 3] = 255
    }
  }
  writeFileSync(path, PNG.sync.write(img))
}

test('one changed pixel is one changed pixel', () => {
  const root = dir({})
  const before = join(root, 'before.png')
  const after = join(root, 'after.png')
  const diff = join(root, 'diff.png')
  writePng(before, 10, 10)
  writePng(after, 10, 10, [[3, 4]])
  const result = compareScreens(before, after, diff)
  assert.equal(result.changed, 1)
  assert.equal(result.total, 100)
  assert.equal(result.percent, 1)
})

test('identical screenshots report no change', () => {
  const root = dir({})
  const a = join(root, 'a.png')
  const b = join(root, 'b.png')
  writePng(a, 8, 8)
  writePng(b, 8, 8)
  assert.equal(compareScreens(a, b, join(root, 'd.png')).changed, 0)
})

test('different sizes are refused, not silently cropped', () => {
  const root = dir({})
  const a = join(root, 'a.png')
  const b = join(root, 'b.png')
  writePng(a, 8, 8)
  writePng(b, 9, 8)
  assert.throws(() => compareScreens(a, b, join(root, 'd.png')), /differ in size/i)
})
