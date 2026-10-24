/* Titles are names, not markdown — and a run of thoughts is one row. */
import { test } from 'node:test'
import assert from 'node:assert/strict'

test('a heading that arrives as a title reads as a title', async () => {
  const { plainTitle } = await import('../server/db.ts')
  const { displayTitle } = await import('../src/lib/title.ts')

  const raw = '# LOONG AUTONOMOUS BUILD MISSION ## Project: PIZZA DIMENSION'
  for (const fn of [plainTitle, displayTitle]) {
    const out = fn(raw)
    assert.doesNotMatch(out, /#/, `${fn.name} left a heading mark`)
    assert.match(out, /LOONG AUTONOMOUS BUILD MISSION/i)
    assert.match(out, /PIZZA DIMENSION/)
  }
  /* emphasis, code marks and bullets go too */
  assert.equal(displayTitle('**fix** the `build`'), 'fix the build')
  assert.equal(displayTitle('- one\n- two'), 'one two')
  /* a normal title is untouched */
  assert.equal(displayTitle('the API redesign'), 'the API redesign')
})
