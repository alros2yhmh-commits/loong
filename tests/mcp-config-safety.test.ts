import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/* the config lives in DATA_DIR; point it at a throwaway folder before load so
   this never reads or writes the developer's real ~/.loong */
const dataDir = mkdtempSync(join(tmpdir(), 'loong-mcp-safety-'))
process.env.LOONG_DATA_DIR = dataDir

const { assertSafeMcpConfig, loadMcpConfig, maskMcpConfig, unmaskMcpConfig, MASKED, rejectedMcpServers } =
  await import('../server/mcp.ts')

after(() => {
  rmSync(dataDir, { recursive: true, force: true })
})

function writeConfig(raw: unknown): void {
  writeFileSync(join(dataDir, 'mcp.json'), JSON.stringify(raw), 'utf8')
}

/* ---------------------------------------------------------------------------
   mcp.json is the input to `spawn`. It can be written by the settings
   endpoint, but it can equally be hand-edited, restored from a backup, or
   dropped in by another tool — so the check that guards the write path has to
   guard the read path too. A hostile entry that only ever existed on disk used
   to reach the transport untouched.
   --------------------------------------------------------------------------- */

test('a hostile entry written straight to disk is dropped on load, not spawned', () => {
  writeConfig({ mcpServers: { evil: { command: 'node & calc.exe' } } })
  const cfg = loadMcpConfig()
  assert.equal(cfg.mcpServers['evil'], undefined)
  assert.match(rejectedMcpServers()['evil'] ?? '', /shell metacharacters/)
})

test('one bad server does not take the working ones down with it', () => {
  writeConfig({
    mcpServers: {
      evil: { command: 'node | rm -rf /' },
      good: { command: 'node', args: ['server.mjs'] },
      alsoGood: { url: 'https://example.com/mcp' },
    },
  })
  const cfg = loadMcpConfig()
  assert.deepEqual(Object.keys(cfg.mcpServers).sort(), ['alsoGood', 'good'])
  assert.deepEqual(Object.keys(rejectedMcpServers()), ['evil'])
})

test('args may not carry a line break, which splits the command line on Windows', () => {
  assert.throws(
    () => assertSafeMcpConfig({ mcpServers: { s: { command: 'node', args: ['ok\n--danger'] } } }),
    /line breaks/,
  )
  assert.doesNotThrow(() =>
    assertSafeMcpConfig({ mcpServers: { s: { command: 'node', args: ['--flag=1', 'a path with spaces'] } } }),
  )
})

test('env may not override the loader, the interpreter or the program search path', () => {
  for (const key of ['PATH', 'NODE_OPTIONS', 'LD_PRELOAD', 'DYLD_INSERT_LIBRARIES', 'COMSPEC', 'PYTHONPATH']) {
    assert.throws(
      () => assertSafeMcpConfig({ mcpServers: { s: { command: 'node', env: { [key]: 'x' } } } }),
      new RegExp(key),
      `${key} must be refused`,
    )
  }
  /* an ordinary secret value is fine — only the key is dangerous */
  assert.doesNotThrow(() =>
    assertSafeMcpConfig({ mcpServers: { s: { command: 'node', env: { GITHUB_TOKEN: 'ghp_x|y$z' } } } }),
  )
})

test('cwd must be a plain path', () => {
  assert.throws(
    () => assertSafeMcpConfig({ mcpServers: { s: { command: 'node', cwd: 'x & y' } } }),
    /plain path/,
  )
  assert.doesNotThrow(() =>
    assertSafeMcpConfig({ mcpServers: { s: { command: 'node', cwd: 'C:\\Users\\me\\projects' } } }),
  )
})

/* ---------------------------------------------------------------------------
   integrations.ts stores live GitHub/Notion tokens in `env`, and an sse server
   can carry an Authorization header. Neither may reach the renderer.
   --------------------------------------------------------------------------- */

const SECRET_CONFIG = {
  mcpServers: {
    github: { command: 'node', args: ['gh.js'], env: { GITHUB_PERSONAL_ACCESS_TOKEN: 'ghp_supersecret' } },
    remote: { url: 'https://example.com/sse', headers: { Authorization: 'Bearer abc123' } },
  },
}

test('the config that leaves the server carries no secret values', () => {
  const masked = maskMcpConfig(SECRET_CONFIG)
  const wire = JSON.stringify(masked)
  assert.equal(wire.includes('ghp_supersecret'), false)
  assert.equal(wire.includes('abc123'), false)
  /* the key must still be visible, so the UI can show that one is set */
  assert.deepEqual(Object.keys(masked.mcpServers['github'].env ?? {}), ['GITHUB_PERSONAL_ACCESS_TOKEN'])
  assert.equal(masked.mcpServers['github'].env?.['GITHUB_PERSONAL_ACCESS_TOKEN'], MASKED)
  assert.equal(masked.mcpServers['remote'].headers?.['Authorization'], MASKED)
  /* non-secret fields survive untouched */
  assert.deepEqual(masked.mcpServers['github'].args, ['gh.js'])
  assert.equal(masked.mcpServers['remote'].url, 'https://example.com/sse')
})

test('saving a masked config back does not erase the stored secret', () => {
  writeConfig(SECRET_CONFIG)
  const stored = loadMcpConfig()
  const echoed = maskMcpConfig(stored)
  const merged = unmaskMcpConfig(echoed, stored)
  assert.equal(merged.mcpServers['github'].env?.['GITHUB_PERSONAL_ACCESS_TOKEN'], 'ghp_supersecret')
  assert.equal(merged.mcpServers['remote'].headers?.['Authorization'], 'Bearer abc123')
})

test('a genuinely new value typed in the UI still wins over the mask', () => {
  writeConfig(SECRET_CONFIG)
  const stored = loadMcpConfig()
  const edited = maskMcpConfig(stored)
  edited.mcpServers['github'].env = { GITHUB_PERSONAL_ACCESS_TOKEN: 'ghp_rotated' }
  const merged = unmaskMcpConfig(edited, stored)
  assert.equal(merged.mcpServers['github'].env?.['GITHUB_PERSONAL_ACCESS_TOKEN'], 'ghp_rotated')
})

test('a server removed in the UI stays removed after unmasking', () => {
  writeConfig(SECRET_CONFIG)
  const stored = loadMcpConfig()
  const merged = unmaskMcpConfig({ mcpServers: { github: stored.mcpServers['github'] } }, stored)
  assert.deepEqual(Object.keys(merged.mcpServers), ['github'])
})
