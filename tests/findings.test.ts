import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { counts, fingerprint, listFindings, recordFindings, updateFinding } from '../server/findings.ts'
import { formatEntry, kbForRule, kbSearch, kbStats } from '../server/security-kb.ts'
import { redTeam } from '../server/red-team.ts'

const CRITICAL = {
  severity: 'critical' as const,
  rule: 'exposed-env',
  file: 'http://127.0.0.1:1234/.env',
  line: 0,
  snippet: 'environment file served',
}

test('the KB answers a question and maps scanner rules to a page', () => {
  const hits = kbSearch('sql injection')
  assert.ok(hits.length >= 1)
  assert.equal(hits[0].id, 'CWE-89')
  assert.match(formatEntry(hits[0]), /Fix:/)

  assert.equal(kbForRule('sqli')?.id, 'CWE-89')
  assert.equal(kbForRule('innerhtml')?.id, 'CWE-79')
  assert.equal(kbForRule('nope-not-a-rule'), null)
  assert.ok(kbStats().entries >= 40)
})

test('a finding is fingerprinted by rule and file, not by line', () => {
  assert.equal(fingerprint('eval', 'src/a.ts'), fingerprint('eval', 'src/a.ts'))
  assert.notEqual(fingerprint('eval', 'src/a.ts'), fingerprint('eval', 'src/b.ts'))
  assert.notEqual(fingerprint('eval', 'src/a.ts'), fingerprint('innerhtml', 'src/a.ts'))
  assert.equal(fingerprint('eval', 'src\\a.ts'), fingerprint('eval', 'src/a.ts'))
})

test('the ledger adds once and re-detection does not duplicate', () => {
  const first = recordFindings([CRITICAL])
  assert.equal(first.added, 1)
  assert.equal(first.open, 1)
  assert.equal(first.critical, 1)

  const again = recordFindings([CRITICAL])
  assert.equal(again.added, 0)
  assert.equal(again.total, 1)
})

test('a fixed finding reopens when the scanner sees it again', () => {
  recordFindings([CRITICAL])
  const open = listFindings('open').find((f) => f.rule === 'exposed-env')
  assert.ok(open)
  const fixed = updateFinding(open.id, 'fixed')
  assert.equal(fixed?.status, 'fixed')
  assert.equal(counts().fixed, 1)

  const back = recordFindings([CRITICAL])
  assert.equal(back.revived, 1)
  assert.equal(listFindings('open').some((f) => f.id === open.id), true)
})

test('accepting a risk keeps it out of the open count', () => {
  recordFindings([CRITICAL])
  const open = listFindings('open')[0]
  updateFinding(open.id, 'accepted')
  assert.equal(counts().open, 0)
  assert.equal(counts().accepted, 1)
})

test('an unknown finding id answers null instead of inventing one', () => {
  assert.equal(updateFinding('deadbeef', 'fixed'), null)
})

test('red team refuses a third-party host before any request', async () => {
  await assert.rejects(() => redTeam('https://example.com'), /Refused: red_team only probes this machine/)
  await assert.rejects(() => redTeam('ftp://127.0.0.1:21'), /only http and https/)
})

test('red team finds an exposed .env and missing headers on a local server', async () => {
  const server = createServer((req, res) => {
    if (req.url === '/.env') {
      res.writeHead(200, { 'content-type': 'text/plain' })
      res.end('DATABASE_URL=postgres://secret\nAPI_TOKEN=abc123\n')
      return
    }
    res.writeHead(200, { 'content-type': 'text/html' })
    res.end('<html><body>ok</body></html>')
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = (server.address() as AddressInfo).port
  try {
    const r = await redTeam(`http://127.0.0.1:${port}`)
    assert.ok(r.probed >= 2)
    const rules = r.findings.map((f) => f.rule)
    assert.ok(rules.includes('exposed-env'), `rules: ${rules.join(',')}`)
    assert.ok(rules.includes('missing-csp'))
    assert.ok(rules.includes('missing-frame-guard'))
    assert.equal(r.findings.find((f) => f.rule === 'exposed-env')?.severity, 'critical')
    assert.match(r.report, /this machine only/)
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
})
