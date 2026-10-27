import { readFileSync } from 'node:fs'
import { defineConfig } from 'vite'
import type { Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwind from '@tailwindcss/vite'

/* One source of truth for the version: the package, injected here. The About
   pane used to say 1.0.0 while the installer said 2.0.0 — two numbers that were
   both "the version" and neither of them true. */
const version = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')).version as string

/* The packaged interface loads over file://, so the base must be relative or
   every asset resolves to file:///assets/... and the window is blank. */

/* A content policy for the packaged window only.

   It has to be injected at build time rather than written into index.html:
   the dev server needs inline scripts (React refresh) and an HMR websocket,
   and a policy loose enough for those is not worth shipping.

   `style-src 'unsafe-inline'` is required — the interface sets most of its
   colour through style attributes. Inline *style* cannot run code; inline
   *script* can, and that stays closed. */
const CSP = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src http://127.0.0.1:* ws://127.0.0.1:*",
  "media-src 'self' data: blob:",
  "worker-src 'self' blob:",
  "base-uri 'none'",
  "form-action 'none'",
  "object-src 'none'",
].join('; ')

function contentPolicy(): Plugin {
  return {
    name: 'loong-csp',
    apply: 'build',
    transformIndexHtml(html) {
      return html.replace(
        '<head>',
        `<head>\n    <meta http-equiv="Content-Security-Policy" content="${CSP}" />`,
      )
    },
  }
}

export default defineConfig({
  base: './',
  plugins: [react(), tailwind(), contentPolicy()],
  define: { __APP_VERSION__: JSON.stringify(version) },
  server: {
    port: 5273,
    strictPort: true,
    /* the packaged app loads over file:// and talks to the agent by absolute
       URL; in the dev browser a relative /api would hit Vite itself and report
       "agent offline" while the agent is right there on 5274 */
    proxy: { '/api': { target: 'http://127.0.0.1:5274', changeOrigin: false } },
  },
  build: { outDir: 'dist', target: 'es2022' },
})
