import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const dataDir = mkdtempSync(join(tmpdir(), 'loong-skills-'))
process.env.LOONG_DATA_DIR = dataDir

const { listSkills, selectSkills, skillsBlock } = await import('../server/skills.ts')

after(() => {
  try {
    rmSync(dataDir, { recursive: true, force: true })
  } catch {
    /* best effort */
  }
})

test('the starter skills are seeded', () => {
  assert.ok(listSkills().length >= 4)
})

test('a game task selects the game-dev skill', () => {
  const picked = selectSkills('build a godot platformer with sprites and physics')
  assert.ok(picked.some((s) => s.name === 'game-dev'))
})

test('a design task selects web-design or design-critic', () => {
  const picked = selectSkills('redesign the landing page ui, it looks generic and ugly')
  assert.ok(picked.some((s) => s.name === 'web-design' || s.name === 'design-critic'))
})

test('an unrelated task injects nothing', () => {
  assert.equal(skillsBlock('calculate 2 + 2'), '')
})

test('the skills block is capped', () => {
  const b = skillsBlock('security vulnerability auth injection xss', 200)
  assert.ok(b.length <= 210)
})
