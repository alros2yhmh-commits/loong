import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ThinkFilter } from '../server/think.ts'

test('a closing think tag never reaches the reader', () => {
  const filter = new ThinkFilter()
  assert.equal(filter.push('</think>'), '')
  assert.equal(filter.flush(), '')
})

test('a tag split across two deltas is still removed', () => {
  const filter = new ThinkFilter()
  assert.equal(filter.push('hello <thi'), 'hello ')
  assert.equal(filter.push('nk>world'), 'world')
  assert.equal(filter.flush(), '')
})

test('text around the tag survives intact', () => {
  const filter = new ThinkFilter()
  const out = filter.push('before</think>after<thinking>more') + filter.flush()
  assert.equal(out, 'beforeaftermore')
})

test('ordinary prose that happens to end in t is not held forever', () => {
  const filter = new ThinkFilter()
  let out = ''
  out += filter.push('I want')
  out += filter.push(' to know')
  out += filter.flush()
  assert.equal(out, 'I want to know')
})
