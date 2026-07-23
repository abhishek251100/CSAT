import tailwindcss from '@tailwindcss/vite'
import { tanstackRouter } from '@tanstack/router-plugin/vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [
    // Must precede the react plugin: it generates routeTree.gen.ts from src/routes.
    tanstackRouter({ target: 'react', autoCodeSplitting: true }),
    react(),
    tailwindcss(),
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    port: 5173,
    /**
     * Fail if 5173 is taken rather than silently moving to 5174.
     *
     * A moved web port is a broken app, not a working one: VITE_API_URL and the
     * API's CORS allowlist are both pinned to the 5173 origin, so a fallback
     * port loads a page that cannot talk to the API and shows "Could not reach
     * the API". Failing loudly points at the real problem — a stale dev server
     * still holding the port — instead of hiding it.
     */
    strictPort: true,
  },
})
