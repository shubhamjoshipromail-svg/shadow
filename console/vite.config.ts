import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const api = process.env.SHADOW_API ?? 'http://localhost:8000'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: {
      '/api': api,
      '/v1': api,
      '/health': api,
      '/capture.js': api,
      '/ws': { target: api.replace(/^http/, 'ws'), ws: true },
    },
  },
})
