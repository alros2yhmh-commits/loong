import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const moduleUrl = new URL('../server/keys.ts', import.meta.url).href
const fixtureKey = 'fixture-provider-credential-keep-private'

function child(directory: string, master: string | undefined, program: string): Record<string, unknown> {
  const env: NodeJS.ProcessEnv = { ...process.env, LOONG_DATA_DIR: directory }
  if (master) env.LOONG_KEY_ENCRYPTION_KEY = master
  else delete env.LOONG_KEY_ENCRYPTION_KEY
  const result = spawnSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-e',
    `const store = await import(${JSON.stringify(moduleUrl)}); ${program}`], {
    cwd: resolve(import.meta.dirname, '..'), env, encoding: 'utf8', timeout: 15_000,
  })
  assert.equal(result.status, 0, result.stderr)
  return JSON.parse(result.stdout.trim()) as Record<string, unknown>
}

test('encrypted provider credentials survive restart without writing secrets or leaking the bridge variable', () => {
  const directory = mkdtempSync(join(tmpdir(), 'loong-vault-'))
  const master = randomBytes(32).toString('base64')
  try {
    const first = child(directory, master, `store.loadKeys(); store.setKey('openrouter', ${JSON.stringify(fixtureKey)}); store.setBaseUrl('custom', 'http://127.0.0.1:9999/v1'); console.log(JSON.stringify({ storage:store.keyStorageStatus(), bridgePresent:'LOONG_KEY_ENCRYPTION_KEY' in process.env }));`)
    assert.deepEqual(first.storage, { mode: 'encrypted' })
    assert.equal(first.bridgePresent, false)
    const content = readFileSync(join(directory, 'keys.json'), 'utf8')
    assert.equal(content.includes(fixtureKey), false)
    assert.equal(content.includes(master), false)
    assert.equal(content.includes('127.0.0.1:9999'), false)
    assert.equal(JSON.parse(content).encrypted, true)
    const second = child(directory, master, `store.loadKeys(); console.log(JSON.stringify({ key:store.keyFor('openrouter'), url:store.baseUrlFor('custom'), status:store.keyStatus(), storage:store.keyStorageStatus() }));`)
    assert.equal(second.key, fixtureKey)
    assert.equal(second.url, 'http://127.0.0.1:9999/v1')
    assert.equal(JSON.stringify(second.status).includes(fixtureKey), false)
    if (process.platform !== 'win32') assert.equal(statSync(join(directory, 'keys.json')).mode & 0o777, 0o600)
  } finally { rmSync(directory, { recursive: true, force: true }) }
})

test('legacy plaintext migrates atomically when an OS-unwrapped key becomes available', () => {
  const directory = mkdtempSync(join(tmpdir(), 'loong-vault-migrate-'))
  try {
    writeFileSync(join(directory, 'keys.json'), JSON.stringify({ openrouter: fixtureKey, baseUrls: { custom: 'http://localhost:9999/v1' } }))
    const result = child(directory, randomBytes(32).toString('base64'), `store.loadKeys(); console.log(JSON.stringify({ key:store.keyFor('openrouter'), storage:store.keyStorageStatus(), url:store.baseUrlFor('custom') }));`)
    assert.equal(result.key, fixtureKey)
    assert.deepEqual(result.storage, { mode: 'encrypted' })
    assert.equal(result.url, 'http://localhost:9999/v1')
    const migrated = readFileSync(join(directory, 'keys.json'), 'utf8')
    assert.equal(migrated.includes(fixtureKey), false)
    assert.equal(JSON.parse(migrated).encrypted, true)
  } finally { rmSync(directory, { recursive: true, force: true }) }
})

test('wrong or missing master keys fail closed and preserve the original credential file', () => {
  const directory = mkdtempSync(join(tmpdir(), 'loong-vault-locked-'))
  try {
    const correct = randomBytes(32).toString('base64')
    child(directory, correct, `store.setKey('openrouter', ${JSON.stringify(fixtureKey)}); console.log('{}');`)
    const original = readFileSync(join(directory, 'keys.json'), 'utf8')
    for (const master of [undefined, randomBytes(32).toString('base64'), 'invalid-key']) {
      const locked = child(directory, master, `store.loadKeys(); let failed=false;try{store.setKey('openrouter','replacement')}catch{failed=true}; console.log(JSON.stringify({ failed, storage:store.keyStorageStatus(), keySet:Boolean(store.keyFor('openrouter')) }));`)
      assert.equal(locked.failed, true)
      assert.equal(locked.keySet, false)
      assert.equal((locked.storage as { mode: string }).mode, 'unavailable')
      assert.equal(readFileSync(join(directory, 'keys.json'), 'utf8'), original)
    }
    const recovered = child(directory, correct, `store.loadKeys(); console.log(JSON.stringify({ key:store.keyFor('openrouter') }));`)
    assert.equal(recovered.key, fixtureKey)
  } finally { rmSync(directory, { recursive: true, force: true }) }
})

test('corrupt stores are preserved and a headless plaintext fallback is explicitly identified', () => {
  const directory = mkdtempSync(join(tmpdir(), 'loong-vault-fallback-'))
  try {
    const fallback = child(directory, undefined, `store.setKey('custom','fixture-local-key'); console.log(JSON.stringify({ storage:store.keyStorageStatus() }));`)
    assert.deepEqual(fallback.storage, { mode: 'plaintext' })
    assert.equal(readFileSync(join(directory, 'keys.json'), 'utf8').includes('fixture-local-key'), true)
    writeFileSync(join(directory, 'keys.json'), '{broken-original')
    const result = child(directory, randomBytes(32).toString('base64'), `store.loadKeys();let failed=false;try{store.setKey('custom','new-value')}catch{failed=true}; console.log(JSON.stringify({ failed, storage:store.keyStorageStatus() }));`)
    assert.equal(result.failed, true)
    assert.equal((result.storage as { mode: string }).mode, 'unavailable')
    assert.equal(readFileSync(join(directory, 'keys.json'), 'utf8'), '{broken-original')
  } finally { rmSync(directory, { recursive: true, force: true }) }
})


test('short credentials are fully masked and saved keys load on first lookup', () => {
  const directory = mkdtempSync(join(tmpdir(), 'loong-vault-lazy-'))
  try {
    writeFileSync(join(directory, 'keys.json'), JSON.stringify({ custom: 'tiny', baseUrls: { custom: 'http://localhost:9999/v1' } }))
    const result = child(directory, undefined, `console.log(JSON.stringify({ key:store.keyFor('custom'), url:store.baseUrlFor('custom'), status:store.keyStatus() }));`)
    assert.equal(result.key, 'tiny')
    assert.equal(result.url, 'http://localhost:9999/v1')
    assert.equal((result.status as Record<string, { hint: string }>).custom.hint, '••••')
  } finally { rmSync(directory, { recursive: true, force: true }) }
})
