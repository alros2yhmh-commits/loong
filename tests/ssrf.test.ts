import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fetchTool } from '../server/tools.ts'

/* ---------------------------------------------------------------------------
   fetch_url is a read tool, so it is never gated by an approval. That makes
   the host/IP blocklist the only thing standing between a prompt-injected
   webpage and the cloud metadata endpoint, the loopback agent API, or a
   private network share.

   The IPv4 rules used to be reachable only through a literal `d.d.d.d`, so
   every IPv6 spelling that *embeds* an IPv4 address walked straight past
   them. These are the payloads that got through.
   --------------------------------------------------------------------------- */

const execute = (fetchTool as unknown as { execute: (a: { url: string }, b: unknown) => Promise<unknown> }).execute

async function refused(url: string): Promise<boolean> {
  const out = String(await execute({ url }, {}))
  return out.startsWith('Refused:')
}

test('an IPv4-mapped IPv6 literal is blocked, in both spellings', async () => {
  assert.equal(await refused('http://[::ffff:169.254.169.254]/latest/meta-data/'), true)
  assert.equal(await refused('http://[::ffff:a9fe:a9fe]/latest/meta-data/'), true)
})

test('an IPv4-mapped literal cannot reach the loopback agent API', async () => {
  assert.equal(await refused('http://[::ffff:127.0.0.1]:5274/api/mcp/config'), true)
})

test('private ranges are blocked through the mapped form', async () => {
  assert.equal(await refused('http://[::ffff:10.0.0.5]/'), true)
  assert.equal(await refused('http://[::ffff:192.168.1.1]/'), true)
  assert.equal(await refused('http://[::ffff:172.16.0.1]/'), true)
})

test('the other IPv4-bearing IPv6 forms are blocked too', async () => {
  assert.equal(await refused('http://[::169.254.169.254]/'), true, 'IPv4-compatible')
  assert.equal(await refused('http://[::ffff:0:169.254.169.254]/'), true, 'IPv4-translated')
  assert.equal(await refused('http://[64:ff9b::169.254.169.254]/'), true, 'NAT64')
  assert.equal(await refused('http://[2002:a9fe:a9fe::]/'), true, '6to4')
})

test('the plain spellings are still blocked', async () => {
  assert.equal(await refused('http://169.254.169.254/latest/meta-data/'), true)
  assert.equal(await refused('http://[::1]:5274/'), true)
  assert.equal(await refused('http://localhost:5274/'), true)
  assert.equal(await refused('http://metadata.google.internal/'), true)
})

test('an ordinary IPv6 group pair is NOT reinterpreted as an IPv4 address', async () => {
  /* `::a:b` outside the reserved ::/96 spellings must stay a normal address,
     otherwise the fix blocks large parts of the public IPv6 internet. These
     are unreachable hosts, so they fail for a reason other than the blocklist. */
  for (const url of ['http://[2606:4700:4700::1111]/', 'http://[2001:4860:4860::8888]/']) {
    const out = String(await execute({ url }, {}))
    assert.equal(
      out.startsWith('Refused: blocked'),
      false,
      `${url} must not be mistaken for a private address: ${out.slice(0, 120)}`,
    )
  }
})
