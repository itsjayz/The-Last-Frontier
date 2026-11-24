import react from '@vitejs/plugin-react'
import { wgslVitePlugin } from 'vgpu/client'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  // vgpu compiles and reflects .wgsl at build time (no WGSL parser ships to the browser).
  plugins: [react(), wgslVitePlugin({ minify: true })],
})
