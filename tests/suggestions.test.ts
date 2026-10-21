import test from 'node:test'
import assert from 'node:assert/strict'
import { suggestionsFor } from '../src/lib/suggestions.ts'

test('a running turn offers no suggestions', () => {
  assert.deepEqual(suggestionsFor('tests passed', { running: true }), [])
})

test('an empty answer offers nothing', () => {
  assert.deepEqual(suggestionsFor(''), [])
})

test('a test failure suggests running the tests', () => {
  const s = suggestionsFor('The tests failed with an error')
  assert.ok(s.some((x) => /test/i.test(x)))
})

test('a change suggests showing the diff', () => {
  const s = suggestionsFor('I changed two files and updated the component')
  assert.ok(s.some((x) => /diff/i.test(x)))
})

test('at most three suggestions', () => {
  const s = suggestionsFor('tests failed, changed files, error, ui design, commit, plan next')
  assert.ok(s.length <= 3)
})
