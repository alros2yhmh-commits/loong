import test from 'node:test'
import assert from 'node:assert/strict'
import { gateDecision } from '../server/confidence.ts'

/* the pure decision the run makes around a confidence estimate:
   act when it clears the threshold, ask when it does not or when the estimate
   could not be produced at all (fail closed) */

test('a confidence at or above the threshold runs automatically', () => {
  assert.equal(gateDecision({ confidence: 0.7, rationale: '' }, 0.7), 'auto')
  assert.equal(gateDecision({ confidence: 0.95, rationale: '' }, 0.7), 'auto')
})

test('a confidence below the threshold parks for review', () => {
  assert.equal(gateDecision({ confidence: 0.69, rationale: '' }, 0.7), 'ask')
  assert.equal(gateDecision({ confidence: 0.2, rationale: '' }, 0.7), 'ask')
})

test('a missing estimate always parks — never guesses', () => {
  assert.equal(gateDecision(null, 0), 'ask')
  assert.equal(gateDecision(null, 1), 'ask')
})
