import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { loadTasks, prepareTask, selfTestTask, validateTask } from '../evals/harness.ts'

test('the evaluation catalog contains 30 distinct bilingual functional tasks with multiple categories', async () => {
  const tasks = await loadTasks()
  assert.equal(tasks.length, 30)
  assert.equal(new Set(tasks.map(task => task.id)).size, 30)
  assert.ok(tasks.some(task => task.language === 'ar'))
  assert.ok(tasks.some(task => task.language === 'en'))
  assert.ok(new Set(tasks.map(task => task.category)).size >= 8)
  assert.ok(tasks.filter(task => task.category === 'multifile').length >= 4)
})

test('every oracle passes functional acceptance and every seeded defect fails it', async () => {
  const results = []
  for (const task of await loadTasks()) results.push(await selfTestTask(task))
  const failures = results.filter(result => !result.passed)
  assert.deepEqual(failures, [], JSON.stringify(failures, null, 2))
})

test('acceptance is independent of model-written project checks and does not modify the workspace', async () => {
  const task = (await loadTasks()).find(task => task.id === 'clamp-boundaries')!
  const root = await prepareTask(task)
  try {
    await writeFile(join(root, 'package.json'), JSON.stringify({ scripts: { check: 'node -e "process.exit(0)"' } }))
    const before = await readFile(join(root, 'src', 'module.mjs'), 'utf8')
    const result = await validateTask(task, root)
    assert.equal(result.passed, false, 'A passing project command cannot override hidden acceptance.')
    assert.equal(await readFile(join(root, 'src', 'module.mjs'), 'utf8'), before)
  } finally { await rm(root, { recursive: true, force: true }) }
})
