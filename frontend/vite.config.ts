import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import basicSsl from '@vitejs/plugin-basic-ssl'
import path from 'path'

// HTTPS on localhost is required because Meta rejects the Instagram OAuth
// redirect URI if it's plain http. basicSsl generates a self-signed cert
// on the fly — the browser will show a "not secure" warning the first
// time; click through it. To kill the warning entirely, swap for
// mkcert-generated certs.
export default defineConfig({
  plugins: [react(), tailwindcss(), basicSsl()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:8000',
        changeOrigin: true,
      },
    },
  },
})
