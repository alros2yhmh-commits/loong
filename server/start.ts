import { serve } from '@hono/node-server'
import { app } from './index.ts'
import { HOST, PORT, getWorkspace } from './config.ts'
import { loadRuntimeKeys } from './providers.ts'

/* Entry point for the agent process. Kept separate from the routes so the app
   can be imported by tests without a socket being opened. */

/* the main process hands over the OS-encrypted keys once per launch; they are
   read into memory and the handshake file is deleted immediately */
loadRuntimeKeys()

const server = serve({ fetch: app.fetch, port: PORT, hostname: HOST }, (info) => {
  console.log(`[loong] agent server  http://${HOST}:${info.port}`)
  console.log(`[loong] workspace      ${getWorkspace()}`)
})

const shutdown = () => {
  server.close(() => process.exit(0))
  setTimeout(() => process.exit(0), 1500).unref()
}
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
