/* ---------------------------------------------------------------------------
   The gate for 4.4, run by hand: start a real project, wait for its port,
   screenshot it. Not part of `npm test` because it launches a browser and a
   server — slow and environment-dependent, which is exactly what a unit suite
   must not be.

     node --import tsx scripts/smoke-run-project.ts
   --------------------------------------------------------------------------- */

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setWorkspace } from '../server/config.ts'
import { createRunProjectTool, stopProject } from '../server/project-run.ts'

const dir = mkdtempSync(join(tmpdir(), 'loong-runproj-'))
writeFileSync(
  join(dir, 'package.json'),
  JSON.stringify({ name: 'smoke', scripts: { dev: 'node server.mjs' } }),
)
writeFileSync(
  join(dir, 'server.mjs'),
  `
import { createServer } from 'node:http'
const html = '<!doctype html><html><body style="margin:0;background:#fff;font-family:sans-serif"><h1 style="padding:40px">Loong run_project</h1></body></html>'
createServer((req, res) => {
  res.writeHead(200, { 'content-type': 'text/html' })
  res.end(html)
}).listen(5199, '127.0.0.1', () => console.log('http://127.0.0.1:5199'))
`,
)

setWorkspace(dir)
const tool = createRunProjectTool('smoke-run', true)

let ok = false
try {
  const out = await tool.execute!({ waitMs: 25_000 }, {} as never)
  const text = String(out)
  console.log(text.slice(0, 700))
  ok = text.includes('127.0.0.1:5199') && text.includes('SHOT:')
  console.log(ok ? '\nGATE PASSED' : '\nGATE FAILED')
} finally {
  await stopProject('smoke-run')
  /* Windows keeps the killed server's cwd handle for a moment */
  await new Promise((resolve) => setTimeout(resolve, 800))
  try {
    rmSync(dir, { recursive: true, force: true })
  } catch {
    /* a locked temp dir is not a failed gate */
  }
}

process.exit(ok ? 0 : 1)
