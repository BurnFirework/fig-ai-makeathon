import { defineConfig } from 'vite'
import tailwindcss from '@tailwindcss/vite'
import { fileURLToPath, URL } from 'node:url'
import react from '@vitejs/plugin-react'
import { API_ORIGIN, devProxyOrigin } from './server/dev-origin'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  envDir: fileURLToPath(new URL('../..', import.meta.url)),
  // Keep ?url translation imports out of the dependency prebundler's JSON loader.
  optimizeDeps: { exclude: ['@tldraw/assets'] },
  resolve: { alias: { '@': fileURLToPath(new URL('./client', import.meta.url)) } },
  server: {
    proxy: {
      '/api': {
        target: API_ORIGIN,
        // Vite may start on 5174+ when 5173 is taken; vouch for this dev server's own page so the API accepts it.
        configure(proxy) {
          proxy.on('proxyReq', (proxyReq, request) => {
            const origin = devProxyOrigin(request.headers.origin, request.headers.host)
            if (origin) proxyReq.setHeader('origin', origin)
          })
        },
      },
    },
  },
})
