import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { createServer } from 'node:net'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { chromium } from 'playwright-core'

// Real renderer acceptance checks with a deterministic backend, without AI keys.
const root = fileURLToPath(new URL('..', import.meta.url))
const executablePath = [process.env.LOONG_BROWSER, '/usr/bin/chromium', '/usr/bin/chromium-browser',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', chromium.executablePath()]
  .find((candidate) => candidate && existsSync(candidate))
if (!executablePath) throw new Error('Install Chromium/Chrome or set LOONG_BROWSER to its executable to run smoke:ui.')
const port = await new Promise((resolve, reject) => {
  const server = createServer()
  server.once('error', reject)
  server.listen(0, '127.0.0.1', () => { const address = server.address(); server.close(() => resolve(address.port)) })
})
let output = ''
const vite = spawn(process.execPath, [join(root, 'node_modules/vite/bin/vite.js'), '--host', '127.0.0.1', '--port', String(port), '--strictPort'], {
  cwd: root, stdio: ['ignore', 'pipe', 'pipe'],
})
vite.stdout.on('data', (chunk) => { output = (output + chunk).slice(-8000) })
vite.stderr.on('data', (chunk) => { output = (output + chunk).slice(-8000) })
let browser
try {
  const address = `http://127.0.0.1:${port}`
  let ready = false
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (vite.exitCode !== null) throw new Error(`Vite exited: ${output}`)
    ready = await fetch(address).then((response) => response.ok).catch(() => false)
    if (ready) break
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  assert.ok(ready, `Renderer did not start: ${output}`)
  browser = await chromium.launch({ executablePath, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] })
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 }, reducedMotion: 'reduce' })
  page.setDefaultTimeout(12_000)
  const pageErrors = []
  page.on('pageerror', (error) => pageErrors.push(error.message))
  await page.addInitScript(() => localStorage.setItem('loong.direction', 'rtl'))
  let settings = { provider: 'openrouter', model: 'audit/original:free', route: 'auto', mode: 'agent', trust: 'ask',
    soundEnabled: false, volume: 0.4, reducedMotion: true, fontSize: 14, view: 'normal', userName: '' }
  const session = { id: 'ui-smoke-session', title: 'UI acceptance task', workspace: '/tmp/loong-ui-project', createdAt: Date.now(), updatedAt: Date.now() }
  let sessionCreated = false
  let sent
  let startRequests = 0
  let streamRequests = 0
  let approvalAttempts = 0
  let approved = false
  let rewindRequests = 0
  let releaseApproval
  const approval = new Promise((resolve) => { releaseApproval = resolve })
  const now = Date.now()
  const rawEvents = [
    { type: 'RUN_STARTED' },
    { type: 'TOOL_CALL_START', toolCallId: 'write-1', toolCallName: 'write_file' },
    { type: 'TOOL_CALL_ARGS', toolCallId: 'write-1', delta: JSON.stringify({ path: 'module.ts', content: 'export const count = 1' }) },
    { type: 'TOOL_CALL_RESULT', toolCallId: 'write-1', content: 'Created module.ts', result: 'Created module.ts' },
    { type: 'CUSTOM', name: 'loong.checks', value: { ok: true, label: 'npm test', command: 'npm test', exitCode: 0, seconds: 0.1, output: '1 passed' } },
    { type: 'TOOL_CALL_START', toolCallId: 'edit-1', toolCallName: 'edit_file' },
    { type: 'TOOL_CALL_ARGS', toolCallId: 'edit-1', delta: JSON.stringify({ path: 'module.ts', oldText: '1', newText: '2' }) },
    { type: 'TOOL_CALL_RESULT', toolCallId: 'edit-1', content: 'Edited module.ts', result: 'Edited module.ts' },
    { type: 'CUSTOM', name: 'loong.approval_requested', value: { id: 'approval-1', tool: 'shell', title: 'Run the verification command', detail: 'npm test', input: { command: 'npm test' }, createdAt: now } },
    { type: 'CUSTOM', name: 'loong.approval_resolved', value: { id: 'approval-1', approved: true } },
    { type: 'CUSTOM', name: 'loong.outcome', value: { status: 'partial', reason: 'One requested feature remains unfinished.', model: 'audit/reliable:free' } },
    { type: 'RUN_FINISHED', result: { status: 'partial', reason: 'One requested feature remains unfinished.', model: 'audit/reliable:free', promptTokens: 120, completionTokens: 30 } },
  ]
  const events = rawEvents.map((event, index) => ({ ...event, runId: 'ui-smoke-run', threadId: session.id, timestamp: now + index, sequence: index + 1 }))
  const record = () => ({ id: 'ui-smoke-run', threadId: session.id, sessionId: session.id, workspace: session.workspace,
    provider: 'openrouter', selectedModel: 'audit/reliable:free', actualModel: 'audit/reliable:free', mode: 'agent', route: 'manual', trust: 'ask',
    createdAt: now, updatedAt: now, sequence: approved ? events.length : 9, status: approved ? 'partial' : 'running', settled: approved })
  const modelRequests = []
  await page.route('**/api/**', async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    const path = url.pathname
    const method = request.method()
    const json = (body, status = 200) => route.fulfill({ status, json: body })
    if (path === '/api/settings') {
      if (method === 'PUT') settings = { ...settings, ...request.postDataJSON().settings }
      return json({ settings, folders: {} })
    }
    if (path === '/api/health') return json({ ok: true, workspace: session.workspace })
    if (path === '/api/workspace') return json({ workspace: session.workspace })
    if (path === '/api/providers') return json({ providers: [{ id: 'openrouter', label: 'OpenRouter', keyed: true }, { id: 'ollama', label: 'Ollama', keyed: false }] })
    if (/^\/api\/(?:models|catalog\/models|openrouter\/models)$/.test(path)) {
      modelRequests.push(path)
      return json({ models: [{ id: 'audit/reliable:free', name: 'Audit model', supportsTools: true, tools: true, contextLength: 32768, context: 32768, outputLimit: 8192, free: true, promptPrice: '0', completionPrice: '0' }] })
    }
    if (path === '/api/sessions') {
      if (method === 'POST') { sessionCreated = true; return json({ session }) }
      return json({ sessions: sessionCreated ? [session] : [] })
    }
    if (path.startsWith('/api/threads/')) return json({ blocks: [], ok: true })
    if (path.startsWith('/api/sessions/')) return json({ session, messages: [], running: false, blocks: 0, ok: true })
    if (path === '/api/runs/start') { startRequests += 1; sent = request.postDataJSON(); return json({ run: record() }) }
    if (path === '/api/runs') return json({ runs: sent ? [record()] : [] })
    if (path === '/api/runs/ui-smoke-run') return json({ run: record(), events: approved ? events : events.slice(0, 9) })
    if (path === '/api/runs/ui-smoke-run/events' || path === '/api/agent') {
      streamRequests += 1
      if (path === '/api/agent') sent = request.postDataJSON()
      const after = Number(url.searchParams.get('after') ?? 0)
      if (after >= 9 && !approved) await approval
      const selected = (approved ? events : events.slice(0, 9)).filter((event) => event.sequence > after)
      if (after >= 9) selected.unshift(...events.slice(0, 4)) // Simulate duplicated replay frames.
      return route.fulfill({ status: 200, contentType: 'text/event-stream', body: selected.map((event) => `id: ${event.sequence}\ndata: ${JSON.stringify(event)}\n\n`).join('') })
    }
    if (path === '/api/approvals/approval-1') {
      approvalAttempts += 1
      if (approvalAttempts === 1) return json({ error: 'Temporary connection failure' }, 503)
      approved = true
      releaseApproval()
      return json({ ok: true })
    }
    if (path === '/api/checkpoints/rewind') {
      rewindRequests += 1
      assert.equal(request.postDataJSON().runId, 'ui-smoke-run', 'Undo must name the selected run')
      const result = { ok: true, runId: 'ui-smoke-run', restored: 1, removed: 0,
        conflicts: [{ path: 'user-edit.ts', reason: 'Later user edits were preserved.' }], failed: [] }
      events.push({ type: 'CUSTOM', name: 'loong.rewound', value: result, runId: 'ui-smoke-run', threadId: session.id, timestamp: Date.now(), sequence: events.length + 1 })
      return json(result)
    }
    if (path === '/api/git/diff') return json({ ok: true, diff: '', files: [{ path: 'module.ts', added: 1, removed: 0 }] })
    if (path === '/api/files') return json({ content: 'export const count = 2' })
    if (path === '/api/findings') return json({ findings: [], counts: { open: 0, critical: 0 } })
    if (path === '/api/timers') return json({ timers: [], pending: [] })
    if (path === '/api/keys') return json({ keys: {} })
    return json({ ok: true })
  })
  await page.goto(address)
  await page.getByRole('textbox', { name: 'Message', exact: true }).waitFor()
  assert.equal(await page.locator('.shell').getAttribute('dir'), 'rtl')
  assert.equal(await page.getByRole('textbox', { name: 'Message', exact: true }).getAttribute('dir'), 'auto')
  await page.getByRole('button', { name: 'audit/original:free', exact: true }).click()
  await page.getByRole('button', { name: /audit\/reliable:free/ }).click()
  assert.equal(settings.route, 'manual', 'Choosing a model must pin it')
  assert.deepEqual(modelRequests, ['/api/openrouter/models'], 'OpenRouter must use its catalog, not Ollama')
  await page.getByRole('textbox', { name: 'Message', exact: true }).fill('أنشئ الميزة واختبرها مع الحفاظ على الكود الحالي')
  await page.getByRole('button', { name: 'Send', exact: true }).click()
  const approve = page.getByRole('button', { name: 'Approve', exact: true })
  await approve.waitFor()
  await page.locator('.task-state').filter({ hasText: 'Reconnecting' }).waitFor()
  assert.equal(sent.mode, 'agent')
  assert.equal(sent.route, 'manual')
  assert.equal(sent.config.model, 'audit/reliable:free')
  await approve.click()
  await page.getByRole('alert').filter({ hasText: 'Temporary connection failure' }).waitFor()
  assert.equal(await approve.isEnabled(), true, 'An unconfirmed decision must remain retryable')
  await approve.click()
  await page.getByRole('region', { name: 'Task result' }).waitFor()
  assert.match(await page.getByRole('region', { name: 'Task result' }).innerText(), /Partially completed/)
  const checks = page.getByRole('tabpanel', { name: /Checks/ })
  await checks.getByText('Outdated', { exact: true }).waitFor()
  await page.getByRole('tab', { name: 'Changes', exact: true }).click()
  await page.getByRole('button', { name: 'Show the patch for module.ts', exact: true }).click()
  await page.getByText('export const count = 2', { exact: true }).waitFor()
  assert.ok(await page.locator('.evidence-code').filter({ hasText: 'export const count' }).getAttribute('dir') === 'ltr')
  assert.equal(rewindRequests, 0)
  await page.getByRole('button', { name: 'Undo this run', exact: true }).click()
  assert.equal(rewindRequests, 0, 'Opening the confirmation must not undo anything')
  await page.getByRole('button', { name: 'Confirm undo', exact: true }).click()
  await page.getByText('Undo was incomplete.', { exact: false }).waitFor()
  await page.getByText('Review preserved conflicts and failures', { exact: true }).click()
  await page.getByText('Later user edits were preserved.', { exact: false }).waitFor()
  assert.equal(rewindRequests, 1)
  await page.getByRole('tab', { name: 'Changes', exact: true }).press('ArrowRight')
  assert.equal(await page.getByRole('tab', { name: /Checks/ }).getAttribute('aria-selected'), 'true')
  assert.equal(startRequests, 1, 'Reconnection must not start another task')
  assert.ok(streamRequests >= 2, 'The UI must reconnect after an interrupted stream')
  assert.equal(await page.locator('main [data-tool-call-id="write-1"]').count(), 1, 'Replayed tool events must not create duplicate rows')
  assert.deepEqual(pageErrors, [], 'Renderer must not throw')
  console.log(JSON.stringify({ passed: ['provider catalog', 'fixed model selection', 'Arabic direction', 'approval failure and retry', 'partial outcome', 'outdated checks', 'file preview', 'keyboard tabs', 'confirmed scoped undo with conflict reporting', 'reconnect and replay without duplicate tools'], aiRequests: 0, approvalAttempts, rewindRequests, startRequests, streamRequests, pageErrors: 0 }))
} finally {
  await browser?.close()
  vite.kill()
}
