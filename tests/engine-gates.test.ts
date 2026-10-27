import { test } from 'node:test'
import assert from 'node:assert/strict'
import { claimsDelivered, unrunScripts } from '../server/agent.ts'
import { isStepLimit } from '../server/engine/kernel.ts'
import { toolResultOutput } from '../server/engine/messages.ts'

test('an image tool result reaches the model as a file, never as base64 prose', () => {
  const out = toolResultOutput({ output: '[image C:\\shot.png]', image: 'iVBORw0KGgo=' }) as {
    type: string
    value: { type: string; mediaType?: string }[]
  }
  assert.equal(out.type, 'content')
  assert.equal(out.value[0].type, 'file')
  assert.equal(out.value[0].mediaType, 'image/png')
})

test('a text tool result stays text', () => {
  const out = toolResultOutput({ output: 'all good' }) as { type: string; value: string }
  assert.equal(out.type, 'text')
  assert.equal(out.value, 'all good')
})

test('the runtime step ceiling is a pause, not a provider fault', () => {
  assert.equal(isStepLimit('Agent runtime exceeded maxIterations (40)'), true)
  assert.equal(isStepLimit('max iterations reached'), true)
  assert.equal(isStepLimit('429 rate limit'), false)
})

test('a counted delivery claim is recognised in both languages', () => {
  assert.equal(claimsDelivered('Section 1 complete — 9/9 submitted. Now Section 2.'), true)
  assert.equal(claimsDelivered('All 19 images answered.'), true)
  assert.equal(claimsDelivered('تم 9/9'), true)
  assert.equal(claimsDelivered('The build is slow and the tests are flaky'), false)
  assert.equal(claimsDelivered('12 files changed'), false)
})

test('a script written and never run is reported; a script that ran is not', () => {
  const files = [
    'C:\\work\\submit_sec1.bat',
    'C:\\work\\sec1_math.js',
    'C:\\work\\notes.md',
    'C:\\work\\report.html',
  ]
  const commands = ['node sec1_math.js', 'curl https://example.test']
  assert.deepEqual(unrunScripts(files, commands), ['C:\\work\\submit_sec1.bat'])
})

test('a script named only in a different case still counts as run (Windows)', () => {
  assert.deepEqual(unrunScripts(['C:\\w\\SUBMIT.BAT'], ['cmd /c submit.bat']), [])
})
