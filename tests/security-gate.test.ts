import test from 'node:test'
import assert from 'node:assert/strict'
import { scanText, hasCritical } from '../server/security-gate.ts'

test('a private key is a critical finding', () => {
  const f = scanText('-----BEGIN RSA PRIVATE KEY-----\nxxxx\n-----END RSA PRIVATE KEY-----', 'a.pem')
  assert.ok(f.length >= 1)
  assert.ok(hasCritical(f))
})

test('an AWS access key is critical', () => {
  const f = scanText("const k = 'AKIAABCDEFGHIJKLMNOP'", 'a.ts')
  assert.ok(f.some((x) => x.rule === 'aws-key'))
  assert.ok(hasCritical(f))
})

test('eval and innerHTML are high, not critical', () => {
  const f = scanText('eval(userInput)\nel.innerHTML = x', 'a.js')
  assert.ok(f.some((x) => x.rule === 'eval'))
  assert.ok(f.some((x) => x.rule === 'innerhtml'))
  assert.equal(hasCritical(f), false)
})

test('insecure http is flagged but localhost is not', () => {
  const bad = scanText('fetch("http://example.com")', 'a.ts')
  assert.ok(bad.some((x) => x.rule === 'insecure-http'))
  const ok = scanText('fetch("http://127.0.0.1:5274")', 'a.ts')
  assert.equal(ok.length, 0)
})

test('a clean file has no findings', () => {
  assert.equal(scanText('export const x = 1\nconst y = x + 2\n', 'a.ts').length, 0)
})
