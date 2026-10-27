import { serve } from '@hono/node-server'
import { app, stopActiveRuns } from './index.ts'
import { HOST, PORT, getWorkspace } from './config.ts'
import { loadRuntimeKeys } from './providers.ts'
import { loadKeys } from './keys.ts'
/* a static import, not a dynamic one: the bundle builder only follows static
   edges, and a headless mode that silently disappears from the shipped bundle
   is worse than a few extra kilobytes */
import { main as headlessMain } from './headless.ts'
import { stopAllServers } from './servers.ts'

/* Entry point for the agent process. Kept separate from the routes so the app
   can be imported by tests without a socket being opened. */

/* `loong-agent run …` is the headless mode every benchmark harness drives —
   one task, no window, the result as JSON on stdout. It must come before the
   server starts: a harness wants a process that exits, not a port that stays. */
if (process.argv[2] === 'run') {
  /* no top-level await: the bundle is CJS and esbuild refuses it. headlessMain
     ends in process.exit, so nothing waits on the promise anyway. */
  void headlessMain(process.argv.slice(3))
} else {
  /* the main process hands over the OS-encrypted keys once per launch; they are
     read into memory and the handshake file is deleted immediately */
  loadRuntimeKeys()
  loadKeys()

  const server = serve({ fetch: app.fetch, port: PORT, hostname: HOST }, (info) => {
    console.log(`[loong] agent server  http://${HOST}:${info.port}`)
    console.log(`[loong] workspace      ${getWorkspace()}`)
  })

  let closing = false
  const shutdown = () => {
    if (closing) return
    closing = true
    const deadline = setTimeout(() => process.exit(0), 3000).unref()
    void Promise.all([stopActiveRuns(), stopAllServers()]).finally(() => {
      server.close(() => { clearTimeout(deadline); process.exit(0) })
    })
  }
  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
}
