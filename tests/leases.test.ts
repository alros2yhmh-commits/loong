import test from 'node:test'
import assert from 'node:assert/strict'
import { acquireWriteLease, activeLeases } from '../server/leases.ts'

/* the P0 guarantee: two runs cannot hold the same file at once, and a released
   file is available again. This is what stops three sessions on one project
   from silently overwriting each other. */

test('a second run cannot take a file the first run holds', async () => {
  const paths = ['loong-lease-test-a.txt']
  const a = await acquireWriteLease('run-a', paths, 100)
  assert.ok(a, 'first lease should be granted')

  const b = await acquireWriteLease('run-b', paths, 150)
  assert.equal(b, null, 'second run must be refused while the first holds it')

  a!.release()
  const c = await acquireWriteLease('run-b', paths, 800)
  assert.ok(c, 'after release the file is available again')
  c!.release()
})

test('the same run may re-enter its own lease', async () => {
  const paths = ['loong-lease-test-b.txt']
  const a = await acquireWriteLease('run-x', paths, 100)
  const b = await acquireWriteLease('run-x', paths, 100)
  assert.ok(a)
  assert.ok(b)
  a!.release()
  b!.release()
})

test('a multi-file lease releases everything when one path is busy', async () => {
  const held = await acquireWriteLease('run-1', ['loong-lease-test-c.txt'], 100)
  assert.ok(held)
  const partial = await acquireWriteLease(
    'run-2',
    ['loong-lease-test-d.txt', 'loong-lease-test-c.txt'],
    120,
  )
  assert.equal(partial, null)
  /* the free file it briefly took must not stay leased */
  const again = await acquireWriteLease('run-2', ['loong-lease-test-d.txt'], 100)
  assert.ok(again)
  again!.release()
  held!.release()
  assert.equal(
    activeLeases().filter((l) => l.path.includes('loong-lease-test')).length,
    0,
  )
})
