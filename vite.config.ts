import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const AGENT = process.env.LOONG_AGENT_URL ?? 'http://127.0.0.1:5274'

export default defineConfig({
  /* relative asset URLs: the packaged app loads index.html over file://, where
     an absolute "/assets/..." points at the drive root and renders nothing */
  base: './',
  plugins: [react(), tailwindcss()],
  server: {
    port: 5273,
    strictPort: true,
    /* the browser only ever talks to the Vite origin. The agent process is on
       loopback behind this proxy, which is where the API key lives. */
    proxy: {
      '/api': {
        target: AGENT,
        changeOrigin: true,
        // SSE must not be buffered
        configure: (proxy) => {
          proxy.on('proxyRes', (proxyRes) => {
            proxyRes.headers['cache-control'] = 'no-cache, no-transform'
          })
        },
      },
    },
  },
  clearScreen: false,
})
