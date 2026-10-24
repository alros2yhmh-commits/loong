import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwind from '@tailwindcss/vite'

/* The packaged interface loads over file://, so the base must be relative or
   every asset resolves to file:///assets/... and the window is blank. */
export default defineConfig({
  base: './',
  plugins: [react(), tailwind()],
  server: { port: 5273, strictPort: true },
  build: { outDir: 'dist', target: 'es2022' },
})
