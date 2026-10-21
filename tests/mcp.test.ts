import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

/* the config lives in DATA_DIR; point it at a throwaway folder before load */
const dataDir = mkdtempSync(join(tmpdir(), 'loong-mcp-data-'))
process.env.LOONG_DATA_DIR = dataDir

const {
  disconnectAll,
  loadMcpConfig,
  mcpStatus,
  mcpTools,
  removeMcpServer,
  saveMcpConfig,
} = await import('../server/mcp.ts')

const fixture = fileURLToPath(new URL('./fixtures/fake-mcp-server.mjs', import.meta.url))

after(async () => {
  await disconnectAll()
  try {
    rmSync(dataDir, { recursive: true, force: true })
  } catch {
    /* best effort */
  }
})

const fake = {
  command: process.execPath,
  args: [fixture],
}

test('a missing config is an empty set, not an error', () => {
  assert.deepEqual(loadMcpConfig(), { mcpServers: {} })
})

test('the config round-trips through disk', () => {
  saveMcpConfig({ mcpServers: { fake } })
  assert.deepEqual(loadMcpConfig().mcpServers.fake.command, process.execPath)
})

test('a stdio server is discovered and its tools are namespaced', async () => {
  const tools = await mcpTools({ approve: async () => true })
  assert.ok(tools['mcp__fake__echo'], 'echo should be namespaced under the server')
  assert.ok(tools['mcp__fake__add'])
})

test('a namespaced tool actually calls the server', async () => {
  const tools = await mcpTools({ approve: async () => true })
  const out = await tools['mcp__fake__echo'].execute!(
    { text: 'hi' },
    { toolCallId: 't1', messages: [] } as never,
  )
  assert.match(JSON.stringify(out), /echo: hi/)
})

test('a denial stops the tool before it reaches the server', async () => {
  let called = false
  const tools = await mcpTools({
    approve: async () => {
      called = true
      return false
    },
  })
  const out = await tools['mcp__fake__echo'].execute!(
    { text: 'hi' },
    { toolCallId: 't2', messages: [] } as never,
  )
  assert.equal(called, true)
  assert.match(String(out), /denied/i)
})

test('a read-only server needs no approval', async () => {
  saveMcpConfig({ mcpServers: { fake: { ...fake, readOnly: true } } })
  await disconnectAll()
  let asked = false
  const tools = await mcpTools({
    approve: async () => {
      asked = true
      return true
    },
  })
  await tools['mcp__fake__add'].execute!(
    { a: 2, b: 3 },
    { toolCallId: 't3', messages: [] } as never,
  )
  assert.equal(asked, false)
  saveMcpConfig({ mcpServers: { fake } })
  await disconnectAll()
})

test('status reports the server, its transport and its tools', async () => {
  const status = await mcpStatus()
  const fakeStatus = status.find((s) => s.name === 'fake')
  assert.ok(fakeStatus)
  assert.equal(fakeStatus!.connected, true)
  assert.equal(fakeStatus!.transport, 'stdio')
  assert.ok(fakeStatus!.tools.includes('echo'))
})

test('remove deletes the entry from the config', async () => {
  assert.equal(removeMcpServer('fake'), true)
  assert.equal(removeMcpServer('fake'), false)
  assert.deepEqual(loadMcpConfig().mcpServers, {})
})
